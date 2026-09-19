import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { neuralMind } from "@/lib/neural-mind";
import { hiveBrain } from "@/lib/hive-brain";
import { appBrain } from "@/lib/app-brain";
import { pendingProposals } from "@/lib/brain-approvals";
import { parseDirective, saveDirective } from "@/lib/mind-directives";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401, headers: { "Content-Type": "application/json" } });
    }

    const userRole = session.user.role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: { "Content-Type": "application/json" } });
    }

    const userId = session.user.id;
    const body = await request.json();
    const { message, conversationId } = body;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    let conversation = conversationId
      ? await prisma.neuralConversation.findUnique({
          where: { id: conversationId },
          include: { messages: { orderBy: { createdAt: "asc" }, take: 10 } },
        })
      : null;

    if (!conversation) {
      const created = await prisma.neuralConversation.create({
        data: { title: message.trim().slice(0, 50), userId },
      });
      conversation = await prisma.neuralConversation.findUnique({
        where: { id: created.id },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 10 } },
      });
    }

    if (!conversation) {
      return new Response(JSON.stringify({ error: "Failed to start conversation" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    await prisma.neuralMessage.create({
      data: { conversationId: conversation.id, role: "user", content: message.trim() },
    });

    const history = (conversation.messages ?? []).map((m) => ({ role: m.role, content: m.content }));

    // A standing instruction is *saved*, not answered and forgotten. This is the
    // hook that lets an operator actually teach the combined mind: the directive
    // is persisted as a mind memory and consulted by every sports prediction from
    // here on. Ordinary conversation parses to null and is untouched.
    const directive = parseDirective(message.trim());
    const saved = directive
      ? await saveDirective({ text: message.trim(), parsed: directive, createdBy: userId })
      : null;

    /*
     * One front door.
     *
     * The route used to assemble an answer itself — try a model, else ask the
     * neural mind — which is how a question about revenue could come back without
     * anyone having checked whether the scheduler was behind. `appBrain.chat`
     * reads every subsystem first and grounds the answer in what it found,
     * routes action requests into the approval queue, and falls back to the
     * deterministic engines when no provider is configured.
     */
    const base = await appBrain.chat(message.trim(), history, { actorId: userId });

    // The confirmation leads the reply so the operator sees immediately that the
    // instruction was understood and is now live, rather than hoping it was.
    const response = saved
      ? {
          ...base,
          text: [
            `📌 Directive saved and active.\n${saved.note}`,
            "It applies to every prediction from the next model pass onward. Revoke it any time from the Directives tab.",
            base.text,
          ]
            .filter(Boolean)
            .join("\n\n"),
          enginesUsed: [...base.enginesUsed, "directive"],
        }
      : base;

    void neuralMind.learnFromInteraction(message.trim(), response.intent, response.text).catch(() => {});

    /* Anything this turn proposed was created after this timestamp, which is how
     * the stream tells "the brain filed a request" from "requests already open". */
    const pendingSince = Date.now() - 1_000;

    const hiveStatus = await hiveBrain.status();

    await prisma.neuralMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: response.text,
        intent: response.intent,
        enginesUsed: response.enginesUsed.join(","),
        metadata: JSON.stringify({
          confidence: response.confidence,
          sources: response.sources,
          understanding: response.understanding,
          readings: response.readings ? { taken: response.readings.taken, missing: response.readings.missing, state: response.readings.state } : null,
        }),
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "metadata",
                conversationId: conversation!.id,
                intent: response.intent,
                enginesUsed: response.enginesUsed,
                // What the brain understood, and what it grounded the answer in.
                // Both are shown in the console: an answer whose evidence the
                // operator cannot see is an answer they have to take on faith.
                understanding: response.understanding,
                readings: response.readings
                  ? {
                      taken: response.readings.taken,
                      missing: response.readings.missing,
                      state: response.readings.state,
                      items: response.readings.readings,
                    }
                  : null,
              }) + "\n"
            )
          );

          if (saved) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "directive", directive: saved }) + "\n"));
          }

          controller.enqueue(encoder.encode(JSON.stringify({ type: "hive", status: hiveStatus }) + "\n"));

          // A queued write is surfaced as its own event so the console can render
          // an Approve / Reject card instead of the operator hunting for it.
          if (pendingSince) {
            const pending = await pendingProposals().catch(() => []);
            const fresh = pending.filter((p) => new Date(p.createdAt).getTime() >= pendingSince);
            if (fresh.length > 0) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: "proposals", proposals: fresh }) + "\n"));
            }
          }

          const text = response.text;
          const chunkSize = 12;
          for (let i = 0; i < text.length; i += chunkSize) {
            controller.enqueue(encoder.encode(JSON.stringify({ type: "chunk", content: text.slice(i, i + chunkSize) }) + "\n"));
            await new Promise(r => setTimeout(r, 15));
          }

          controller.enqueue(encoder.encode(JSON.stringify({ type: "done", fullText: text }) + "\n"));
          controller.close();
        } catch {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "error", message: "Neural processing failed" }) + "\n"));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Transfer-Encoding": "chunked" },
    });
  } catch (error) {
    console.error("Neural chat error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
