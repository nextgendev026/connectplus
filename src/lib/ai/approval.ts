/**
 * Approval, as a stateless signed token.
 *
 * A high-risk operation is not executed when the model asks for it. The tool
 * returns `approval_required` with a token, the console renders an Approve
 * button, and the operation only runs when that exact token comes back from a
 * Super Admin's session.
 *
 * ## Why a token rather than a queue row
 *
 * The obvious implementation is a `PendingApproval` table. This is not that,
 * deliberately. A row is server state: on a serverless host the approval request
 * and the approval click can land on different instances, so the row has to be in
 * the database, which means the agent's safety depends on a migration having been
 * applied — and a deploy that forgets it would silently *auto-approve* rather than
 * fail closed.
 *
 * The token carries its own proof instead. It is an HMAC over the actor, the tool
 * and a hash of the exact arguments, with an expiry. Verifying it needs no shared
 * state at all, and it binds the approval to *that one call*: a token minted for
 * "validate the schema" cannot be replayed to run "migrate the schema", because
 * the arguments are inside the signature.
 *
 * The signing key is `AUTH_SECRET`. When it is absent the module refuses to issue
 * *or* verify, which is the fail-closed direction: no secret means no autonomous
 * high-risk action, rather than an unauthenticated one.
 */

import { createHmac, createHash, timingSafeEqual } from "node:crypto";
import { GuardrailError } from "./guardrails";

/** The verified caller, as established by the route's session check. */
export interface AgentPrincipal {
  actorId: string;
  role: string | null;
}

/**
 * Confirm the caller may drive the agent at all.
 *
 * Called at the route *and* inside every mutating tool. The duplication is the
 * point: the route check protects the endpoint, this one protects the capability,
 * so a future caller that forgets the first cannot bypass the second.
 */
export function assertSuperAdmin(principal: AgentPrincipal | null | undefined): AgentPrincipal {
  if (!principal?.actorId) {
    throw new GuardrailError("Authentication required", "not_super_admin");
  }
  if (principal.role !== "SUPER_ADMIN") {
    throw new GuardrailError("Super Admin access required", "not_super_admin");
  }
  return principal;
}

function signingKey(): Buffer {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new GuardrailError(
      "AUTH_SECRET is not configured, so high-risk operations cannot be approved. " +
        "Set it before using the agent's write tools.",
      "approval_invalid",
    );
  }
  return Buffer.from(secret, "utf8");
}

/**
 * A stable hash of tool arguments.
 *
 * `JSON.stringify` alone is not stable: key order follows insertion order, so the
 * same call described twice could hash differently and invalidate an approval the
 * operator genuinely gave. Sorting the keys fixes that, and the hash is what binds
 * the token to one concrete action.
 */
export function hashArgs(args: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, canonical(v)]),
      );
    }
    return value;
  };
  return createHash("sha256").update(JSON.stringify(canonical(args))).digest("hex");
}

export interface ApprovalRequest {
  actorId: string;
  tool: string;
  args: unknown;
  /** Seconds the token stays valid. Short by design — approvals are immediate. */
  ttlSeconds?: number;
}

export interface ApprovalGrant {
  token: string;
  /** The action being approved, for the card the operator actually reads. */
  summary: string;
  argsHash: string;
  expiresAt: string;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

/**
 * Mint a token for one specific call by one specific admin.
 *
 * @param summary human-readable description of what will happen, shown on the
 *   approval card. It is *not* part of the signature — it is a label for a human,
 *   and letting prose into the signed payload would mean a cosmetic rewording
 *   invalidated live approvals.
 */
export function issueApprovalToken(
  { actorId, tool, args, ttlSeconds = 300 }: ApprovalRequest,
  summary: string,
): ApprovalGrant {
  const argsHash = hashArgs(args);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const payload = Buffer.from(
    JSON.stringify({ a: actorId, t: tool, h: argsHash, e: expiresAt }),
    "utf8",
  ).toString("base64url");

  return { token: `${payload}.${sign(payload)}`, summary, argsHash, expiresAt: new Date(expiresAt).toISOString() };
}

export interface ApprovalVerification {
  ok: boolean;
  reason?: string;
}

/**
 * Check a returned token against the call it claims to authorise.
 *
 * Every clause is a distinct refusal with its own message, because "invalid
 * token" is useless to an operator whose approval card has gone stale: the four
 * real causes are a different admin, a different action, an expired token and a
 * forged one, and they need different responses.
 */
export function verifyApprovalToken(
  token: string,
  { actorId, tool, args }: Omit<ApprovalRequest, "ttlSeconds">,
): ApprovalVerification {
  if (typeof token !== "string" || !token.includes(".")) {
    return { ok: false, reason: "Approval token is malformed." };
  }
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return { ok: false, reason: "Approval token is malformed." };

  let expected: string;
  try {
    expected = sign(payload);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Cannot verify approvals." };
  }

  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: "Approval token signature does not match. It was not issued by this server." };
  }

  let claims: { a?: string; t?: string; h?: string; e?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "Approval token payload is unreadable." };
  }

  if (claims.a !== actorId) {
    return { ok: false, reason: "This approval was issued to a different admin." };
  }
  if (claims.t !== tool) {
    return { ok: false, reason: `This approval was issued for a different tool (${claims.t ?? "unknown"}).` };
  }
  if (claims.h !== hashArgs(args)) {
    return {
      ok: false,
      reason: "The arguments changed after approval. Review the operation and approve it again.",
    };
  }
  if (typeof claims.e !== "number" || claims.e < Date.now()) {
    return { ok: false, reason: "This approval has expired. Ask the agent to propose the operation again." };
  }

  return { ok: true };
}
