import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { neuralMind } from "@/lib/neural-mind";
import { hiveBrain } from "@/lib/hive-brain";
import { appBrain } from "@/lib/app-brain";
import { pendingProposals } from "@/lib/brain-approvals";
import { parseDirective, saveDirective } from "@/lib/mind-directives";
import {
  chronologicalHistory,
  deriveConversationTitle,
  historyFetchSize,
  type ReadingState,
  type StoredReading,
} from "@/lib/chat-history";
import { agentModelConfigured, redactAgentEvent, streamAgentEvents } from "@/lib/ai/agent-loop";
import { shouldRunAgent } from "@/lib/ai/agent-trigger";

/**
 * The console's conversation endpoint.
 *
 * Two properties matter here beyond producing an answer.
 *
 * **A conversation is owned by the admin who started it.** Resuming used to look
 * the id up by primary key alone, so any admin who knew (or guessed) an id could
 * read and append to another admin's thread. The lookup is scoped to the session
 * user now: an id that is not yours is an id that does not exist.
 *
 * **A reply is composed against the recent turns of the same conversation.**
 * See `chat-history.ts` for why that sentence has two failure modes worth
 * isolating. The route fetches the newest rows and hands them to a function that
 * reverses them; it does not build the ordering inline.
 */
/**
 * How many individual readings are kept with a turn.
 *
 * The evidence panel is a summary of what the answer was grounded in, not an
 * archive of the probe list, and a metadata column that grows without a ceiling
 * is a column that eventually cannot be read back.
 */
const MAX_STORED_READINGS = 40;

/**
 * The evidence for one turn, built once and used for both destinations.
 *
 * This is deliberately a single function rather than two inline literals, which
 * is what it used to be: the object streamed to the console carried the readings
 * themselves, while the object written to the database carried only the counts.
 * Nothing noticed, because a live turn renders from the stream — and then
 * reopening that conversation from history handed the console the thinner shape,
 * where `readings.items.length` is a `TypeError` on `undefined`. React surfaced
 * it as the whole admin page dropping into its error boundary, so a saved chat
 * appeared to lead nowhere. Deriving both from one builder makes that drift
 * unrepresentable instead of merely fixed.
 */
function turnEvidence(
  readings: { taken: number; missing: number; state: ReadingState; readings: StoredReading[] } | null | undefined
): { taken: number; missing: number; state: ReadingState; items: StoredReading[] } | null {
  if (!readings) return null;
  return {
    taken: readings.taken,
    missing: readings.missing,
    state: readings.state,
    items: (readings.readings ?? []).slice(0, MAX_STORED_READINGS),
  };
}

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
    const { message } = body;
    const requestedConversationId =
      typeof body.conversationId === "string" && body.conversationId.trim().length > 0
        ? body.conversationId.trim()
        : null;

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const asked = message.trim();

    /*
     * Where does this turn go — the grounded record answer, or the tool loop?
     *
     * Decided up front so the console can be told *why*, and reported on the
     * metadata event. An operator who cannot see the routing cannot tell a model
     * that declined from a pipeline that never tried.
     */
    const agentPlan = shouldRunAgent(asked, (body as { agent?: unknown }).agent);
    const agentBlocked = agentPlan.run && userRole !== "SUPER_ADMIN";
    const agentReady = agentPlan.run && !agentBlocked ? await agentModelConfigured() : false;
    const agentWillRun = agentPlan.run && !agentBlocked && agentReady;
    const agentRouting = {
      ran: agentWillRun,
      reason: agentBlocked
        ? "This needs the agent, which is Super Admin only."
        : agentPlan.run && !agentReady
          ? "This needs the agent, but no model gateway is configured."
          : agentPlan.reason,
      intent: agentPlan.intent,
    };

    /*
     * Resume, or start.
     *
     * `findFirst` scoped to `userId` rather than `findUnique` on the id: another
     * admin's conversation must not be readable through this endpoint, and the
     * cheapest way to guarantee that is to make the query itself incapable of
     * returning one.
     */
    let conversation = requestedConversationId
      ? await prisma.neuralConversation.findFirst({
          where: { id: requestedConversationId, userId },
          include: { messages: { orderBy: { createdAt: "desc" }, take: historyFetchSize() } },
        })
      : null;

    // A conversation id that is unknown, or belongs to someone else, starts a new
    // thread rather than failing the turn — the operator asked a question, and
    // answering it is more useful than an error about a stale tab.
    if (!conversation) {
      const created = await prisma.neuralConversation.create({
        data: { title: deriveConversationTitle(asked), userId },
      });
      conversation = await prisma.neuralConversation.findUnique({
        where: { id: created.id },
        include: { messages: { orderBy: { createdAt: "desc" }, take: historyFetchSize() } },
      });
    }

    if (!conversation) {
      return new Response(JSON.stringify({ error: "Failed to start conversation" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    // The history is read *before* the current turn is written, so it is strictly
    // the prior context and the question is not sent to the model twice.
    const history = chronologicalHistory(conversation.messages ?? []);

    await prisma.neuralMessage.create({
      data: { conversationId: conversation.id, role: "user", content: asked },
    });

    // Bump the conversation so the history list sorts by recency. `updatedAt`
    // only moves on an update, and appending a message is not an update to the
    // conversation row itself.
    await prisma.neuralConversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date() },
    });

    const conversationId = conversation.id;

    // A standing instruction is *saved*, not answered and forgotten. This is the
    // hook that lets an operator actually teach the combined mind: the directive
    // is persisted as a mind memory and consulted by every sports prediction from
    // here on. Ordinary conversation parses to null and is untouched.
    const directive = parseDirective(asked);
    const saved = directive
      ? await saveDirective({ text: asked, parsed: directive, createdBy: userId })
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
    const base = await appBrain.chat(asked, history, { actorId: userId });

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

    void neuralMind.learnFromInteraction(asked, response.intent, response.text).catch(() => {});

    /* Anything this turn proposed was created after this timestamp, which is how
     * the stream tells "the brain filed a request" from "requests already open". */
    const pendingSince = Date.now() - 1_000;

    const hiveStatus = await hiveBrain.status();

    const assistantMessage = await prisma.neuralMessage.create({
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
          readings: turnEvidence(response.readings),
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
                conversationId,
                intent: response.intent,
                enginesUsed: response.enginesUsed,
                // Which engine answered this turn, and why. Surfaced rather than
                // inferred, because "no tools ran" and "the tools were refused"
                // look identical from the outside.
                agent: agentRouting,
                // What the brain understood, and what it grounded the answer in.
                // Both are shown in the console: an answer whose evidence the
                // operator cannot see is an answer they have to take on faith.
                understanding: response.understanding,
                readings: turnEvidence(response.readings),
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

          /*
           * The tool loop, after the grounded answer rather than instead of it.
           *
           * The record answer leads because it is read from the platform and is
           * therefore the more trustworthy half; the agent's work follows it, so a
           * reader gets the facts first and the actions second. Tool events use the
           * same NDJSON stream as everything else, which is what lets one widget
           * render the conversation, the tool cards and the prediction cards without
           * knowing which engine produced any of them.
           */
          let agentText = "";
          if (agentWillRun) {
            for await (const event of streamAgentEvents({
              actor: { actorId: userId, role: userRole },
              turns: [{ role: "user", content: asked }],
            })) {
              // The agent's prose is re-labelled as `chunk`, the event the console
              // already appends to a streaming bubble. One event vocabulary at the
              // boundary beats teaching every client two.
              if (event.type === "text") {
                const delta = String(event.delta ?? "");
                agentText += delta;
                controller.enqueue(encoder.encode(JSON.stringify({ type: "chunk", content: delta }) + "\n"));
                continue;
              }
              controller.enqueue(encoder.encode(`${JSON.stringify(redactAgentEvent(event))}\n`));
            }

            // The stored turn has to contain what the operator actually read, or the
            // next turn's history is missing the agent's half and the console will
            // contradict itself when the thread is reopened.
            if (agentText.trim()) {
              await prisma.neuralMessage
                .update({
                  where: { id: assistantMessage.id },
                  data: { content: `${text}\n\n${agentText.trim()}` },
                })
                .catch(() => {});
            }
          }

          controller.enqueue(encoder.encode(JSON.stringify({ type: "done", fullText: text + (agentText ? `\n\n${agentText}` : "") }) + "\n"));
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
