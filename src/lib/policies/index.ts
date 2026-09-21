import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { AppError, authenticationRequired, forbidden } from "@/lib/errors";
import { hasSharedSecret } from "@/lib/shared-secret";
import { createLogger } from "@/lib/logger";

/**
 * Authorization, in one place, decided server-side.
 *
 * The problem this replaces: 72 route handlers each called `auth()` and then
 * applied their own idea of what to do with the answer. Most were right. The
 * failure mode of that design is not that they were wrong — it is that a *new*
 * route has no obligation to do it at all, and nothing detects the omission. An
 * unprotected endpoint is invisible: it returns 200 to an anonymous caller, which
 * looks exactly like a working endpoint.
 *
 * Three properties are load-bearing:
 *
 *  1. **Scopes are derived, never asserted.** A client cannot send a scope list.
 *     `scopesForRole` is a pure function of the role that `auth.ts` resolves from
 *     the database, so "ai:approve" cannot be granted by anything the caller
 *     controls. The `scopes` array a client receives from `/api/v1/auth/session`
 *     is for its own UI; enforcement re-derives it here.
 *  2. **Deny is the default.** `requireScope` on an unknown role denies. A role
 *     added to the database before this table knows it gets no capabilities
 *     rather than an empty allowlist that reads as permissive.
 *  3. **High-risk actions can demand a fresh session.** A token minted an hour
 *     ago proves who signed in then, not who is at the keyboard now.
 *
 * Ownership is deliberately separate from roles: `requireOwnership` answers "is
 * this your row", which is a different question from "may you moderate".
 */

const log = createLogger("policies");

export const ROLES = ["USER", "ADMIN", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Every capability this API can check.
 *
 * Declared as a union so a route cannot require a scope that no role can hold —
 * a typo would otherwise be a permission that is silently never granted, and the
 * test that walks `SCOPES` would pass it.
 */
export const SCOPES = [
  "posts:read",
  "posts:write",
  "moderation:write",
  "payments:read",
  "payments:write",
  "ai:use",
  "ai:propose",
  "ai:approve",
  "operations:diagnose",
  "operations:repair",
  "deploy:staging",
  "deploy:production",
] as const;

export type Scope = (typeof SCOPES)[number];

const USER_SCOPES: readonly Scope[] = ["posts:read", "posts:write", "ai:use"];

/**
 * What a role may do.
 *
 * Read the admin row as the answer to "what does a trusted operator need":
 * diagnose the platform, propose AI actions, moderate, read money. Not *approve*
 * the AI's proposals (that is the two-person boundary the approval queue exists
 * to enforce), not change payment configuration, and not deploy.
 */
const ROLE_SCOPES: Record<Role, readonly Scope[]> = {
  USER: USER_SCOPES,
  ADMIN: [
    ...USER_SCOPES,
    "moderation:write",
    "payments:read",
    "ai:propose",
    "operations:diagnose",
  ],
  SUPER_ADMIN: [...SCOPES],
};

/** Roles that at least one route treats as "administrative". */
export const ADMIN_ROLES: readonly Role[] = ["ADMIN", "SUPER_ADMIN"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The scopes a role holds.
 *
 * Unknown or missing role → an empty list. Note the direction: an unrecognised
 * role denies, it does not fall back to USER, because a role string that arrives
 * from the database is a bug or a migration in progress and neither should be
 * quietly treated as "a normal user with posting rights".
 */
export function scopesForRole(role: Role | null | undefined): Scope[] {
  if (!role || !isRole(role)) return [];
  return [...ROLE_SCOPES[role]];
}

/** Who the request is from, as resolved from the session. */
export interface Principal {
  actorId: string | null;
  role: Role | null;
  /** True when the account has confirmed its email address. */
  emailVerified: boolean;
}

export const ANONYMOUS: Principal = { actorId: null, role: null, emailVerified: false };

/**
 * Turn whatever the session provider gave us into a Principal.
 *
 * Kept structural (an object with optional fields) rather than typed as a
 * NextAuth `Session`, so a test can build a principal without standing up the
 * provider — and so a change to the session shape is a one-line edit here instead
 * of an edit in every route.
 */
export function principalFromSession(
  session: { user?: { id?: string | null; role?: string | null; emailVerified?: Date | null } | null } | null
): Principal {
  const user = session?.user;
  const actorId = user?.id ?? null;
  if (!actorId) return ANONYMOUS;
  return {
    actorId,
    role: isRole(user?.role) ? user.role : null,
    emailVerified: Boolean(user?.emailVerified),
  };
}

/* ── The required predicates ──────────────────────────────────────────────── */

export function isAuthenticated(principal: Principal): boolean {
  return Boolean(principal.actorId);
}

/** Any signed-in caller. */
export function requireUser(principal: Principal): Principal & { actorId: string } {
  if (!principal.actorId) throw authenticationRequired();
  return { ...principal, actorId: principal.actorId };
}

/** A verified account, for anything that publishes or messages other people. */
export function requireVerifiedUser(principal: Principal): Principal & { actorId: string } {
  const authed = requireUser(principal);
  if (!authed.emailVerified) {
    throw forbidden("Confirm your email address to do that");
  }
  return authed;
}

export function requireRole(principal: Principal, roles: readonly Role[]): Principal & { actorId: string } {
  const authed = requireUser(principal);
  if (!authed.role || !roles.includes(authed.role)) {
    // Deliberately the same answer for "not signed in" and "signed in as the
    // wrong role" is *not* used here: the caller is authenticated, so naming the
    // refusal is more useful than hiding it, and it leaks nothing they do not
    // already know about themselves.
    log.warn("role refused", { actorId: authed.actorId, role: authed.role, required: roles.join(",") });
    throw forbidden();
  }
  return authed;
}

export function requireAdmin(principal: Principal): Principal & { actorId: string } {
  return requireRole(principal, ADMIN_ROLES);
}

export function requireSuperAdmin(principal: Principal): Principal & { actorId: string } {
  return requireRole(principal, ["SUPER_ADMIN"]);
}

/**
 * A capability, checked against the role's grants.
 *
 * This is the function new routes should use in preference to `requireAdmin`:
 * it says what the route needs rather than who it thinks is allowed, so widening
 * a role's powers stays a change in this file.
 */
export function requireScope(principal: Principal, scope: Scope): Principal & { actorId: string } {
  const authed = requireUser(principal);
  const granted = scopesForRole(authed.role);
  if (!granted.includes(scope)) {
    log.warn("scope refused", { actorId: authed.actorId, role: authed.role, scope });
    throw forbidden();
  }
  return authed;
}

export function hasScope(principal: Principal, scope: Scope): boolean {
  return scopesForRole(principal.role).includes(scope);
}

/**
 * "Is this row yours?"
 *
 * A missing owner id is a refusal, not a pass: a record with no owner is not a
 * record everyone owns, and treating `null` as "unowned, therefore fine" is the
 * shape of bug this function exists to prevent.
 */
export function requireOwnership(principal: Principal, ownerId: string | null | undefined): Principal & { actorId: string } {
  const authed = requireUser(principal);
  if (!ownerId || ownerId !== authed.actorId) throw forbidden();
  return authed;
}

/** Ownership, with the administrative override a moderator needs. */
export function requireOwnershipOrRole(
  principal: Principal,
  ownerId: string | null | undefined,
  roles: readonly Role[] = ADMIN_ROLES
): Principal & { actorId: string } {
  const authed = requireUser(principal);
  if (ownerId && ownerId === authed.actorId) return authed;
  if (authed.role && roles.includes(authed.role)) return authed;
  throw forbidden();
}

/* ── Step-up: a fresh session for a high-risk action ──────────────────────── */

/** How long a session may be reused before a risky action needs a new sign-in. */
export const REAUTH_WINDOW_SECONDS = 15 * 60;

/**
 * When the current session was issued.
 *
 * `auth()` returns the session body, not the token, so the issue time has to come
 * from the JWT itself. Returns `null` when there is no token or no `iat` — and a
 * null is treated as *stale* by `requireReauthentication`, because "we cannot tell
 * how old this is" must not mean "assume it is fresh".
 */
export async function sessionIssuedAt(req: NextRequest): Promise<Date | null> {
  try {
    const token = await getToken({ req: req as never, secret: process.env.AUTH_SECRET });
    const issuedAt = (token as { iat?: unknown } | null)?.iat;
    if (typeof issuedAt !== "number") return null;
    return new Date(issuedAt * 1000);
  } catch {
    return null;
  }
}

/**
 * Demand a recent sign-in.
 *
 * For the actions where a stolen-but-valid session is the threat: changing
 * authentication settings, payment configuration, deploying, or switching the
 * self-healing envelope to `enforce`. The answer is 401 rather than 403, because
 * the client's correct response is to re-authenticate, not to give up.
 */
export async function requireReauthentication(
  req: NextRequest,
  principal: Principal,
  options: { maxAgeSeconds?: number } = {}
): Promise<Principal & { actorId: string }> {
  const authed = requireUser(principal);
  const maxAge = options.maxAgeSeconds ?? REAUTH_WINDOW_SECONDS;
  const issuedAt = await sessionIssuedAt(req);

  if (!issuedAt) {
    log.warn("reauthentication demanded — session age unknown", { actorId: authed.actorId });
    throw new AppError(
      "AUTHENTICATION_REQUIRED",
      "Please sign in again to confirm this action"
    );
  }

  const ageSeconds = (Date.now() - issuedAt.getTime()) / 1000;
  if (!Number.isFinite(ageSeconds) || ageSeconds > maxAge) {
    log.warn("reauthentication demanded", { actorId: authed.actorId, ageSeconds: Math.round(ageSeconds) });
    throw new AppError("AUTHENTICATION_REQUIRED", "Please sign in again to confirm this action");
  }
  return authed;
}

/**
 * A scheduler or another service holding the shared secret.
 *
 * Service callers are not users: they have no session and no role, and the only
 * thing they can prove is possession of `CRON_SECRET`. `hasSharedSecret` fails
 * closed when the secret is unset (see `lib/shared-secret`), which is why a
 * deployment that forgot the variable has a closed endpoint rather than an open
 * one.
 */
export function requireServiceCredential(req: NextRequest): void {
  if (!hasSharedSecret(req)) throw authenticationRequired();
}

/* ── Convenience for route handlers ──────────────────────────────────────── */

/**
 * Resolve the caller and demand a scope, in one call.
 *
 * Routes that already import `auth` use `principalFromSession(await auth())`
 * with the pure predicates above; this exists so a route that wants the whole
 * check in one line does not have to import two modules to get it.
 */
export async function authorize(
  resolveSession: () => Promise<Parameters<typeof principalFromSession>[0]>,
  requirement: { scope?: Scope; role?: readonly Role[]; user?: true } = {}
): Promise<Principal> {
  const principal = principalFromSession(await resolveSession());
  if (requirement.scope) return requireScope(principal, requirement.scope);
  if (requirement.role) return requireRole(principal, requirement.role);
  if (requirement.user) return requireUser(principal);
  // No requirement named is a programming error, not a permissive default.
  throw new AppError("INTERNAL_ERROR");
}
