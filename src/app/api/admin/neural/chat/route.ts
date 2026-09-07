import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { neuralMind } from "@/lib/neural-mind";
import { hiveBrain } from "@/lib/hive-brain";
import { classifyIntent } from "@/lib/neural-intent";
import { tryLlmForChat } from "@/lib/ai-provider";

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

    // When an LLM provider is configured (admin Settings → API keys) and the
    // query is conversational/content-creation, let the real model answer;
    // otherwise the deterministic brains handle it (they query the live DB for
    // platform data intents). Graceful fallback keeps the chat fully functional
    // with zero configuration.
    const classified = classifyIntent(message.trim());
    const llmText = await tryLlmForChat(message.trim(), history, classified.intent);

    const response = llmText
      ? {
          text: llmText,
          intent: classified.intent,
          enginesUsed: ["internal", "hive", "llm"] as const,
          confidence: Math.max(classified.confidence, 0.7),
          sources: [] as string[],
        }
      : await neuralMind.processQuery(message.trim(), history);

    void neuralMind.learnFromInteraction(message.trim(), response.intent, response.text).catch(() => {});

    const hiveStatus = await hiveBrain.status();

    await prisma.neuralMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: response.text,
        intent: response.intent,
        enginesUsed: response.enginesUsed.join(","),
        metadata: JSON.stringify({ confidence: response.confidence, sources: response.sources }),
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "metadata", conversationId: conversation!.id, intent: response.intent, enginesUsed: response.enginesUsed }) + "\n"));

          controller.enqueue(encoder.encode(JSON.stringify({ type: "hive", status: hiveStatus }) + "\n"));

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
