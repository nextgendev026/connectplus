import type { NextRequest } from "next/server";

/**
 * One description of "who is calling, from what, and how do I find this request
 * again".
 *
 * The API had a request id in some routes (Next sets `x-request-id`), an actor in
 * others (whatever the route happened to read from the session), and no notion at
 * all of which client was asking. That is enough to answer a question at the
 * time and not enough to answer it afterwards: "the Android app got a 403 an hour
 * ago" was unanswerable, because nothing recorded that the caller was the Android
 * app.
 *
 * Two rules:
 *
 *  1. **Client-supplied values are never trusted verbatim.** A request id arrives
 *     in a header and ends up in a log line and in a response body — an
 *     attacker-chosen one is a log-injection primitive and an unbounded string,
 *     so it is accepted only when it matches a strict shape and everything else
 *     is replaced with a generated id.
 *  2. **Resolving identity costs nothing extra.** `requestContext` reads headers
 *     only. The session is a separate, explicit await (`authenticatedContext`),
 *     so a public route does not pay for a session lookup it does not need.
 */

/** Clients we expect to be talking to this API. */
export const CLIENT_PLATFORMS = ["web", "pwa", "android", "ios", "api", "service", "unknown"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];

export interface RequestContext {
  /** Correlates a response, a log line and an audit row. Always present. */
  requestId: string;
  /** The authenticated user, when the caller resolved identity. */
  actorId: string | null;
  /** Session identifier, when the provider exposes one. */
  sessionId: string | null;
  platform: ClientPlatform;
  /** Version of *this* API the response belongs to. */
  appVersion: string | null;
  /** Version of the calling client. */
  clientVersion: string | null;
  userAgent: string | null;
  locale: string;
  timezone: string;
}

export const REQUEST_ID_HEADER = "x-request-id";

/**
 * A request id we are willing to echo.
 *
 * 8–64 characters of an unambiguous alphabet. Deliberately excludes whitespace,
 * quotes and control characters so a value can be dropped into a log line, a
 * JSON body and an HTTP header without escaping.
 */
const REQUEST_ID_SHAPE = /^[A-Za-z0-9._:-]{8,64}$/;

/** A version string we are willing to echo: `1`, `1.2`, `1.2.3`, `1.2.3-beta.1`. */
const VERSION_SHAPE = /^\d{1,4}(\.\d{1,4}){0,2}(-[A-Za-z0-9.]{1,16})?$/;

/** Timezone identifiers are `Area/Location`; this is the bounded, safe subset. */
const TIMEZONE_SHAPE = /^[A-Za-z]{1,40}(\/[A-Za-z_+-]{1,40}){0,2}$/;

const LOCALE_SHAPE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;

/**
 * The request id for this call: the caller's if it is safe, otherwise a new one.
 *
 * `crypto.randomUUID` is available in the edge and Node runtimes both, which is
 * why this is not `Math.random`-based — a guessable correlation id is worse than
 * none, because it invites trusting it.
 */
export function readRequestId(req: NextRequest): string {
  const supplied = req.headers.get(REQUEST_ID_HEADER)?.trim();
  if (supplied && REQUEST_ID_SHAPE.test(supplied)) return supplied;
  return crypto.randomUUID();
}

function header(req: NextRequest, name: string): string | null {
  const value = req.headers.get(name)?.trim();
  return value ? value : null;
}

function validVersion(value: string | null): string | null {
  return value && VERSION_SHAPE.test(value) ? value : null;
}

/**
 * Best-effort platform detection.
 *
 * An explicit header wins — a client that knows what it is should say so, and a
 * PWA and a browser tab are indistinguishable from the user agent. The user-agent
 * fallback exists because the native clients do not send the header yet, and
 * "unknown" is a legitimate answer: guessing wrong is worse than admitting it.
 */
export function detectPlatform(req: NextRequest): ClientPlatform {
  const declared = header(req, "x-client-platform")?.toLowerCase();
  if (declared && (CLIENT_PLATFORMS as readonly string[]).includes(declared)) {
    return declared as ClientPlatform;
  }

  const ua = header(req, "user-agent")?.toLowerCase() ?? "";
  if (!ua) return "unknown";
  if (ua.includes("connectplus-android")) return "android";
  if (ua.includes("connectplus-ios")) return "ios";
  if (ua.includes("postman") || ua.includes("curl") || ua.includes("node-fetch")) return "api";
  return "web";
}

/** The first language tag from `Accept-Language`, validated. */
export function detectLocale(req: NextRequest): string {
  const raw = header(req, "x-locale") ?? header(req, "accept-language");
  if (!raw) return "en";
  const first = raw.split(",")[0]?.split(";")[0]?.trim() ?? "";
  return LOCALE_SHAPE.test(first) ? first : "en";
}

export function detectTimezone(req: NextRequest): string {
  const raw = header(req, "x-timezone");
  return raw && TIMEZONE_SHAPE.test(raw) ? raw : "UTC";
}

/**
 * The anonymous context: headers only, no database, no session.
 *
 * Safe to call on every request, which is the point — a public read should not
 * pay for an auth lookup to be well-described.
 */
export function requestContext(req: NextRequest): RequestContext {
  return {
    requestId: readRequestId(req),
    actorId: null,
    sessionId: null,
    platform: detectPlatform(req),
    appVersion: header(req, "x-api-version"),
    clientVersion: validVersion(header(req, "x-client-version") ?? header(req, "x-app-version")),
    userAgent: header(req, "user-agent"),
    locale: detectLocale(req),
    timezone: detectTimezone(req),
  };
}

/**
 * A context with no inbound request behind it.
 *
 * For the places that build a response outside a request — a legacy helper, a
 * cron job reporting its own outcome, a test asserting an envelope — where the
 * alternative is a context full of nulls written out by hand. Still gets a real
 * request id, because an uncorrelated response is the thing this module exists
 * to prevent.
 */
export function anonymousContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: crypto.randomUUID(),
    actorId: null,
    sessionId: null,
    platform: "unknown",
    appVersion: null,
    clientVersion: null,
    userAgent: null,
    locale: "en",
    timezone: "UTC",
    ...overrides,
  };
}

/** The shape `authenticatedContext` needs from a session; kept structural so this
 * module does not depend on NextAuth and can be tested without it. */
export interface SessionIdentity {
  userId: string;
  sessionId?: string | null;
}

/**
 * Fill in identity from an already-resolved session.
 *
 * Takes the identity rather than calling `auth()` itself: a unit test can then
 * assert what an authenticated context looks like without standing up NextAuth,
 * and a route that has already resolved its session does not resolve it twice.
 */
export function authenticatedContext(req: NextRequest, session: SessionIdentity): RequestContext {
  const base = requestContext(req);
  return {
    ...base,
    actorId: session.userId || null,
    sessionId: session.sessionId ?? null,
  };
}

/**
 * The context with identity resolved, for routes that require a session.
 *
 * Kept separate from `requestContext` so the import graph stays honest: only a
 * route that needs a session pulls NextAuth in.
 */
export async function requireSessionContext(
  req: NextRequest,
  resolve: () => Promise<{ user?: { id?: string | null } | null } | null>
): Promise<RequestContext> {
  const base = requestContext(req);
  try {
    const session = await resolve();
    const userId = session?.user?.id ?? null;
    return { ...base, actorId: userId };
  } catch {
    // An auth failure is not a context failure: describe the request and let the
    // route decide, rather than turning a session blip into a 500.
    return base;
  }
}
