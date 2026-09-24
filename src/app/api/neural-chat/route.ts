/**
 * The agent endpoint — a thin, Super Admin-only wrapper over the shared tool loop.
 *
 * All the substance lives in `@/lib/ai/agent-loop` and `@/lib/ai/tools`, because
 * the operator's console reaches the same loop through
 * `/api/admin/neural/chat`. This route exists as the honest, single-purpose
 * address for it: a caller who wants tool calls and nothing else gets exactly
 * that, without the console's conversation bookkeeping or the deterministic
 * brain prelude.
 *
 * The whole file is therefore: authorise, read the turns, stream the events. Any
 * logic that is not one of those three things belongs in the library.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { principalFromSession } from "@/lib/policies";
import { GuardrailError } from "@/lib/ai/guardrails";
import { assertSuperAdmin, type AgentPrincipal } from "@/lib/ai/approval";
import { agentModelConfigured, readTurns, redactAgentEvent, streamAgentEvents } from "@/lib/ai/agent-loop";

export const runtime = "nodejs";
export const maxDuration = 300;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const principal = principalFromSession(session);

  let actor: AgentPrincipal;
  try {
    actor = assertSuperAdmin({ actorId: principal.actorId ?? "", role: principal.role });
  } catch {
    // An unauthenticated caller is told to sign in; a signed-in non-admin is told
    // they lack the role. Neither learns what the agent would have done.
    const unauthenticated = !principal.actorId;
    return json(
      { error: unauthenticated ? "Authentication required" : "Super Admin access required" },
      unauthenticated ? 401 : 403,
    );
  }

  if (!(await agentModelConfigured())) {
    return json(
      {
        error: "not_configured",
        message:
          "No model gateway is configured, so the tool loop cannot run. Configure a provider " +
          "(OpenRouter or OpenCode) under the admin console's API settings. The reasoning console " +
          "at /api/admin/neural/chat still answers without one, because it reads the platform's " +
          "own records; this endpoint drives tools, which needs a model.",
      },
      503,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }

  const turns = readTurns(body);
  if (turns.length === 0 || turns[turns.length - 1]!.role !== "user") {
    return json({ error: "At least one user message is required" }, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(redactAgentEvent(event))}\n`));
      };
      try {
        for await (const event of streamAgentEvents({ actor, turns })) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof GuardrailError ? error.message : "The agent failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
