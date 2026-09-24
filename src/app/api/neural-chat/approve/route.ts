/**
 * Execute a high-risk operation a Super Admin has approved.
 *
 * Separate from the streaming route on purpose. The agent's loop ends when it asks
 * for approval; a human then decides, possibly minutes later, possibly after the
 * stream is long gone. Making approval a fresh request means the decision is a new
 * authorisation rather than a continuation of the model's turn — and it means a
 * revoked session cannot ride an open stream to run a migration.
 *
 * Four checks stand between the request and the database, in this order:
 *
 *   1. The caller is a signed-in Super Admin — the same identity that was shown
 *      the approval card.
 *   2. The tool is one a human is allowed to approve. An allowlist, so a future
 *      tool cannot become approvable merely by existing.
 *   3. The token's signature, actor, tool, argument hash and expiry all verify.
 *      This is what makes replaying a token for a different migration impossible.
 *   4. The operation verifies the token again itself, because the capability
 *      guards itself where it runs and not only where it is reached.
 *
 * Nothing here trusts the request to describe what it is approving. The token is
 * the only part that carries proof, and the arguments travel with it purely so the
 * hash can be recomputed and compared.
 */

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { principalFromSession } from "@/lib/policies";
import { GuardrailError } from "@/lib/ai/guardrails";
import { assertSuperAdmin, verifyApprovalToken } from "@/lib/ai/approval";
import { APPROVABLE_TOOLS, agentOperations } from "@/lib/ai/tools";

export const runtime = "nodejs";
export const maxDuration = 300;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  const principal = principalFromSession(session);

  let actor;
  try {
    actor = assertSuperAdmin({ actorId: principal.actorId ?? "", role: principal.role });
  } catch {
    const unauthenticated = !principal.actorId;
    return json(
      { error: unauthenticated ? "Authentication required" : "Super Admin access required" },
      unauthenticated ? 401 : 403,
    );
  }

  let body: { tool?: unknown; args?: unknown; token?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Request body must be JSON" }, 400);
  }

  const tool = typeof body.tool === "string" ? body.tool : "";
  const token = typeof body.token === "string" ? body.token : "";
  const args = body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : {};

  if (!tool || !token) {
    return json({ error: "Both `tool` and `token` are required" }, 400);
  }

  if (!(APPROVABLE_TOOLS as readonly string[]).includes(tool)) {
    return json({ error: `"${tool}" is not an approvable operation` }, 400);
  }

  // The token is verified against the arguments as they will be *executed*, which
  // is exactly the shape the route hashed when it minted the grant.
  const verification = verifyApprovalToken(token, { actorId: actor.actorId, tool, args });
  if (!verification.ok) {
    return json({ error: "approval_rejected", reason: verification.reason }, 409);
  }

  try {
    const result = await agentOperations.managePrismaMigrations({
      ...(args as { action: "create-only"; name?: string }),
      approvalToken: token,
      actorId: actor.actorId,
    });
    return json({ ok: true, tool, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The operation failed.";
    // A guardrail refusal is a 403 with the guardrail's own wording; anything else
    // is a 500, because an unexpected failure in an operation that writes migration
    // files is not something to dress up as a client error.
    return json(
      { error: error instanceof GuardrailError ? "refused" : "operation_failed", message },
      error instanceof GuardrailError ? 403 : 500,
    );
  }
}
