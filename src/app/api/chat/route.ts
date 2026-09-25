import { NextRequest } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText, stepCountIs, type UIMessage } from "ai";
import { auth } from "@/lib/auth";
import { principalFromSession } from "@/lib/policies";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { createLogger } from "@/lib/logger";
import { normalizeInput, routeChatInput } from "@/lib/agent-router";
import { loadUserProfile, recallUserMemory } from "@/lib/agent-memory";
import { generalAgentTools, GENERAL_AGENT_TOOL_NOTES } from "@/lib/agent-tools";
import { buildGeneralAgentPrompt } from "@/lib/agent-prompt";
import { platformIntelligence } from "@/lib/platform-intelligence";
import { resolveToolCallingTarget } from "@/lib/ai-provider";
import { composePromptHistory, deriveConversationTitle } from "@/lib/chat-history";

/**
 * The general-purpose chat endpoint.
 *
 * Distinct from `/api/admin/neural/chat` on purpose: that route answers an
 * operator about platform records and routes actions into the approval queue.
 * This one answers a *person* about anything, with the platform's senses as
 * tools among others. The two share the model gateway, the streaming
 * conventions and the conversation tables — and nothing else.
 *
 * Three properties are load-bearing:
 *
 *   1. **The session is the only identity.** A userId in the request body is
 *      never trusted; the conversation lookup is scoped to the session user,
 *      so an id that is not yours starts a fresh thread rather than leaking
 *      someone else's.
 *   2. **Everything degrades independently.** No profile, no recall, no
 *      model gateway, a failed embed event — each is caught on its own, and
 *      the turn still answers or says plainly why it cannot.
 *   3. **Memory is written after the turn, off the critical path.** The
 *      stream returns immediately; persistence and the embed event happen in
 *      a detached block so a slow database never delays a token.
 */

const log = createLogger("chat");

export const runtime = "nodejs";
export const maxDuration = 120;

/** How many prior turns of this conversation join the prompt. */
const HISTORY_TURNS = 15;

/** How much stored text a recalled memory contributes. */
const MAX_RECALL_CHARS = 5;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const principal = principalFromSession(session);
  if (!principal.actorId) {
    return json({ error: "Authentication required" }, 401);
  }
  const userId = principal.actorId;

  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown; conversationId?: unknown };
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }

  const rawMessages = Array.isArray(body.messages) ? (body.messages as UIMessage[]) : [];
  // UI messages carry parts, not a string, in v7.
  const lastUser = [...rawMessages].reverse().find((m) => m?.role === "user");
  const rawText =
    lastUser?.parts?.find((p): p is { type: "text"; text: string } => p?.type === "text")?.text ?? "";

  const asked = normalizeInput(rawText);
  if (!asked) {
    return json({ error: "A non-empty message is required" }, 400);
  }

  /* ── Model gateway ────────────────────────────────────────────────────── */
  const target = await resolveToolCallingTarget().catch(() => null);
  if (!target) {
    return json(
      {
        error: "not_configured",
        message:
          "No model gateway is configured. Set a provider and key under Admin → Settings → API; " +
          "the platform's own records still answer at /api/admin/neural/chat without one.",
      },
      503
    );
  }

  /* ── Conversation: resume the user's own, or start one ────────────────── */
  const requestedId = typeof body.conversationId === "string" && body.conversationId.trim() ? body.conversationId.trim() : null;
  let conversation = requestedId
    ? await prisma.neuralConversation.findFirst({
        where: { id: requestedId, userId },
        include: { messages: { orderBy: { createdAt: "desc" }, take: HISTORY_TURNS } },
      })
    : null;

  if (!conversation) {
    const created = await prisma.neuralConversation.create({
      data: { title: deriveConversationTitle(asked), userId },
    });
    conversation = await prisma.neuralConversation.findUnique({
      where: { id: created.id },
      include: { messages: { orderBy: { createdAt: "desc" }, take: HISTORY_TURNS } },
    });
  }
  if (!conversation) {
    return json({ error: "Failed to start conversation" }, 500);
  }
  const conversationId = conversation.id;

  /* ── Persist the user turn before answering ───────────────────────────── */
  const userMessage = await prisma.neuralMessage.create({
    data: { conversationId, userId, role: "user", content: asked },
    select: { id: true },
  });

  /* ── Context: routing, memory, platform brief ─────────────────────────── */
  const decision = routeChatInput(asked);
  const [profile, recall, brief] = await Promise.all([
    loadUserProfile(userId),
    recallUserMemory(userId, asked, MAX_RECALL_CHARS),
    decision.route === "platform"
      ? platformIntelligence.getLiveBrief().catch(() => null)
      : Promise.resolve(null),
  ]);

  /* ── History: stored turns + the new one ──────────────────────────────── */
  const priorTurns = (conversation.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(0, HISTORY_TURNS)
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  // The client re-sends its own copy of the recent turns. The store is
  // authoritative for what it holds, the client for what the store missed (a
  // reply whose persist failed after the tab closed), and the current question
  // lands exactly once at the end — concatenating the two halves used to send
  // every recent turn twice and the question three times over.
  const clientTurns = rawMessages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-6)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: (m.parts ?? [])
        .map((part) => (part?.type === "text" && typeof part.text === "string" ? part.text : ""))
        .join(" ")
        .trim(),
    }))
    .filter((turn) => turn.content.length > 0);

  const history = composePromptHistory(priorTurns, clientTurns, asked);

  /* ── Stream ───────────────────────────────────────────────────────────── */
  const client = createOpenAI({ apiKey: target.apiKey, baseURL: target.baseUrl, headers: target.extraHeaders });

  const result = streamText({
    model: client(target.model),
    system: buildGeneralAgentPrompt({
      languageMix: profile.languageMix,
      summary: profile.summary,
      recall,
      platformBrief: brief ? JSON.stringify(brief).slice(0, 2_000) : null,
      toolNotes: GENERAL_AGENT_TOOL_NOTES,
    }),
    messages: history,
    tools: generalAgentTools({ userId }),
    // Read → (search | compute | read platform) → answer fits inside five
    // steps; a bound this tight is also the agent's blast radius.
    stopWhen: stepCountIs(5),
    onError: ({ error }) => {
      log.error("chat stream error", { error: error instanceof Error ? error.message : String(error) });
    },
  });

  /* ── Memory writes, off the critical path ─────────────────────────────── */
  void (async () => {
    try {
      // Hold the stream open server-side even if the client tab closes, so the
      // persisted transcript is what the user actually read.
      try {
        await result.consumeStream();
      } catch {
        // A client-aborted stream is not a failed turn.
      }
      const answerText = (await result.text) ?? "";
      const usedTools = [...new Set((await result.steps).flatMap((s) => s.toolCalls.map((c) => c.toolName)))];

      const assistant = await prisma.neuralMessage.create({
        data: {
          conversationId,
          userId,
          role: "assistant",
          content: answerText || "(no reply)",
          intent: decision.route,
          enginesUsed: usedTools.join(","),
          metadata: JSON.stringify({ route: decision.route, confidence: decision.confidence }),
        },
        select: { id: true },
      });

      await prisma.neuralConversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      // Embedding + profile update run in the background job; the chat turn
      // itself must not pay for them.
      await inngest
        .send({
          name: "chat/embed",
          data: { messageId: assistant.id, userId, userMessageId: userMessage.id, userText: asked },
        })
        .catch(() => {});
    } catch (error) {
      log.warn("chat memory write failed", { error: error instanceof Error ? error.message : String(error) });
    }
  })();

  return result.toUIMessageStreamResponse({
    originalMessages: rawMessages,
    sendReasoning: false,
    sendStart: true,
    sendFinish: true,
  });
}
