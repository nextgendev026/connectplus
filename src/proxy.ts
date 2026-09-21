import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { hasSharedSecret } from "@/lib/shared-secret";
import { errorPayload } from "@/lib/errors";
import { getToken } from "next-auth/jwt";

declare global {
  var __rateLimitCleanup: boolean | undefined;
}

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

/**
 * Who is asking, and can we believe it?
 *
 * The old key was `x-forwarded-for.split(",")[0]` — the *first* value in a header
 * any client can set. That is not a weak identity, it is an identity the caller
 * chooses: rotating one header mints a fresh bucket per request, so every
 * anonymous ceiling in the table below (sign-in 10/15min, register 5/15min,
 * payments 120/min) was bypassable by writing a different number in a header.
 *
 * Two fixes, because the two failure modes are different:
 *
 *  1. **Prefer an address the platform set.** On Vercel, `x-vercel-forwarded-for`
 *     is written by the edge the request actually arrived at; `x-forwarded-for`
 *     is the client's own claim passed through. Where we can tell the difference,
 *     we use the trustworthy one.
 *  2. **When we cannot attribute the caller, they share a bucket.** A rotating
 *     spoof would otherwise be unbounded. Anonymous traffic we cannot attribute
 *     is limited by a single shared ceiling per route, so spoofing buys an
 *     attacker nothing except competing with everyone else. That is a worse
 *     experience for a shared NAT than for an attacker, which is the correct
 *     direction for a limit whose job is protecting the origin.
 *
 * Signed-in callers are keyed by user id instead, which is stable, one per
 * account, and cannot be forged without a session — the original reason this
 * function existed, so a writer behind a shared IP is not throttled with
 * strangers.
 */
export interface RateIdentity {
  key: string;
  /** False when the address came from a header we cannot verify. */
  attributed: boolean;
}

/** Set by the hosting platform, not by the client. */
const PLATFORM_IP_HEADERS = ["x-vercel-forwarded-for", "cf-connecting-ip"] as const;

function firstIp(value: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first ? first : null;
}

export async function resolveRateIdentity(request: NextRequest): Promise<RateIdentity> {
  const path = request.nextUrl.pathname;

  const token = await getToken({ req: request as never, secret: process.env.AUTH_SECRET }).catch(
    () => null
  );
  if (token?.sub) return { key: `uid:${token.sub}:${path}`, attributed: true };

  for (const header of PLATFORM_IP_HEADERS) {
    const address = firstIp(request.headers.get(header));
    if (address) return { key: `ip:${address}:${path}`, attributed: true };
  }

  const claimed = firstIp(request.headers.get("x-forwarded-for"));
  if (claimed) {
    // Recorded for the log and for per-address fairness, but marked
    // unattributed so the shared ceiling applies on top of it.
    return { key: `unverified:${claimed}:${path}`, attributed: false };
  }

  return { key: `anonymous:${path}`, attributed: false };
}

function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
    return false;
  }

  entry.count++;
  return entry.count > limit;
}

if (typeof globalThis.__rateLimitCleanup === "undefined") {
  globalThis.__rateLimitCleanup = true;
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now > entry.resetTime) {
        rateLimitMap.delete(key);
      }
    }
  }, 60000);
}

type LimitRule = { limit: number; windowMs: number };
type LimitKey = keyof typeof RATE_LIMIT_NAMES;

const RATE_LIMIT_NAMES = {
  REGISTER: "/api/auth/register",
  SIGNIN: "/api/auth/signin",
  UPLOAD: "/api/upload",
  COMMENTS: "/api/comments",
  POSTS: "/api/posts",
  FOLLOWS: "/api/follows",
  BOOKMARKS: "/api/bookmarks",
  RSS_POLL: "/api/rss/poll",
  RSS_CRON: "/api/rss/cron",
  RSS_FEEDS: "/api/rss/feeds",
  RSS_IMPORT: "/api/rss/import",
  NEURAL_CHAT: "/api/admin/neural/chat",
  NEURAL_LEARN: "/api/admin/neural/learn",
  // Research reads the open web and writes what it finds into long-term memory.
  // A loop here is both egress and a way to poison the hive.
  NEURAL_TRAIN: "/api/admin/neural/train",
  ADMIN_USERS: "/api/admin/users",
  ADMIN_STATS: "/api/admin/stats",
  USER_SETTINGS: "/api/user/settings",
  USER_PASSWORD: "/api/user/password",
  // Checkout starts an STK push, which costs a real Safaricom round trip and
  // buzzes a member's phone: a loop here is both an egress bill and a nuisance.
  SUBSCRIPTION_MANAGE: "/api/subscription/manage",
  // The two provider notification endpoints are unauthenticated by necessity
  // (the providers cannot present a session), so the only defence in front of
  // them is a ceiling on how often one caller can make us do the lookup work.
  DARAJA_CALLBACK: "/api/payments/daraja/callback",
  PAYPAL_WEBHOOK: "/api/payments/paypal/webhook",
  PAYMENT_INTENT: "/api/payments/intents",
  // AI spend. Each of these can call a model, and a model call is the most
  // expensive thing this API does.
  AI_GENERATE: "/api/ai",
  // Proposing is cheap but approving is consequential: bound how fast proposals
  // can be filed so a chat loop cannot bury the queue.
  BRAIN_APPROVALS: "/api/admin/brain/approvals",
  // Device registration arrives from clients that are not yet authenticated
  // against anything else (Phase M), so it needs its own ceiling.
  DEVICES: "/api/v1/devices",
  // Radio (R-01 in docs/RADIO-AUDIT.md). Both are unauthenticated by design —
  // the dial has to work before anyone signs in — and both make US fetch a
  // third party on the caller's behalf.
  //
  // `/probe` walks a station's whole failover chain, one serial request at a
  // time, so a loop here is egress the platform pays for.
  RADIO_PROBE: "/api/radio/probe",
  // `/stream` is the expensive one: a live audio body held open for up to 300s,
  // re-served from our origin, paid for by us. A legitimate listener opens one
  // connection and keeps it, so a per-minute ceiling well above the retry rate
  // costs an honest listener nothing while a scraper of thousands of concurrent
  // streams hits it immediately.
  RADIO_STREAM: "/api/radio/stream",
} as const;

const DEFAULTS: Record<LimitKey, LimitRule> = {
  REGISTER: { limit: 5, windowMs: 15 * 60 * 1000 },
  SIGNIN: { limit: 10, windowMs: 15 * 60 * 1000 },
  UPLOAD: { limit: 20, windowMs: 60 * 1000 },
  COMMENTS: { limit: 30, windowMs: 60 * 1000 },
  POSTS: { limit: 30, windowMs: 60 * 1000 },
  FOLLOWS: { limit: 30, windowMs: 60 * 1000 },
  BOOKMARKS: { limit: 60, windowMs: 60 * 1000 },
  RSS_POLL: { limit: 5, windowMs: 5 * 60 * 1000 },
  RSS_CRON: { limit: 10, windowMs: 60 * 1000 },
  RSS_FEEDS: { limit: 30, windowMs: 60 * 1000 },
  RSS_IMPORT: { limit: 10, windowMs: 60 * 1000 },
  NEURAL_CHAT: { limit: 30, windowMs: 60 * 1000 },
  NEURAL_LEARN: { limit: 10, windowMs: 60 * 1000 },
  NEURAL_TRAIN: { limit: 6, windowMs: 60 * 1000 },
  ADMIN_USERS: { limit: 60, windowMs: 60 * 1000 },
  ADMIN_STATS: { limit: 30, windowMs: 60 * 1000 },
  USER_SETTINGS: { limit: 20, windowMs: 60 * 1000 },
  USER_PASSWORD: { limit: 10, windowMs: 60 * 1000 },
  SUBSCRIPTION_MANAGE: { limit: 12, windowMs: 60 * 1000 },
  // High ceilings: Safaricom can legitimately deliver a burst of callbacks after
  // a promotion, and PayPal retries aggressively. The limit is here to stop a
  // flood, not to rate-limit normal settlement traffic.
  DARAJA_CALLBACK: { limit: 120, windowMs: 60 * 1000 },
  PAYPAL_WEBHOOK: { limit: 120, windowMs: 60 * 1000 },
  // The checkout page polls this every few seconds while a prompt is open.
  PAYMENT_INTENT: { limit: 60, windowMs: 60 * 1000 },
  AI_GENERATE: { limit: 40, windowMs: 60 * 1000 },
  // An operator approving queued work is not a robot, but a runaway console tab
  // should not be able to decide a proposal a thousand times a minute. Refusals
  // are counted, not just approvals, so guessing at proposal ids is bounded too.
  BRAIN_APPROVALS: { limit: 120, windowMs: 60 * 1000 },
  DEVICES: { limit: 20, windowMs: 60 * 1000 },
  // A station has at most a handful of channels and the player advances through
  // them on failure, so a real tuner stays far below this even while switching.
  RADIO_PROBE: { limit: 30, windowMs: 60 * 1000 },
  // Deliberately generous: a listener who switches stations for a minute must
  // never be told they are rate limited. This bounds a flood, it does not pace a
  // person. Note the honest limit — a rate limit caps *attempts*, not concurrent
  // connections, so a caller well inside this ceiling can still hold streams
  // open; capping that needs shared state and is tracked as remaining work in
  // the radio audit rather than pretended here.
  RADIO_STREAM: { limit: 60, windowMs: 60 * 1000 },
};

export const DEFAULT_API_LIMIT = 100;
export const DEFAULT_API_WINDOW_MS = 60 * 1000;

/** The ceiling shared by callers we cannot attribute, as a multiple of theirs. */
const UNATTRIBUTED_SHARED_MULTIPLIER = 8;

// Optional env overrides, e.g. RATE_LIMIT_SIGNIN="20:900000" or
// RATE_LIMIT_UPLOAD="40:30000". Falls back to the defaults table.
function resolveRule(key: LimitKey): LimitRule {
  const fallback = DEFAULTS[key];
  const raw = process.env[`RATE_LIMIT_${key}`];
  if (!raw) return fallback;
  const match = raw.trim().match(/^(\d+):(\d+)$/);
  if (!match) return fallback;
  const limit = parseInt(match[1]!, 10);
  const windowMs = parseInt(match[2]!, 10);
  if (!Number.isFinite(limit) || !Number.isFinite(windowMs)) return fallback;
  return { limit, windowMs };
}

function defaultApiLimit(): LimitRule {
  const raw = process.env.RATE_LIMIT_DEFAULT;
  if (!raw) return { limit: DEFAULT_API_LIMIT, windowMs: DEFAULT_API_WINDOW_MS };
  const match = raw.trim().match(/^(\d+):(\d+)$/);
  if (!match) return { limit: DEFAULT_API_LIMIT, windowMs: DEFAULT_API_WINDOW_MS };
  return { limit: parseInt(match[1]!, 10), windowMs: parseInt(match[2]!, 10) };
}

/* ── CSRF: a cookie-authenticated mutation must come from our own origin ──── */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Routes that legitimately arrive from a third party with no session cookie.
 *
 * Exempt because they carry something better: a signature the route verifies
 * (PayPal) or a reference matched against a payment intent we issued (Daraja).
 * The exemption is a list of paths rather than a header nobody sends, so it can
 * be read in one place and reviewed.
 */
const CSRF_EXEMPT_PREFIXES = [
  "/api/payments/daraja/callback",
  "/api/payments/paypal/webhook",
] as const;

function requestHost(request: NextRequest): string | null {
  // The URL's own host first: it is always present and is what the request was
  // addressed to. A `host` header is set by the transport, not by `new Request`,
  // so relying on it alone would refuse same-origin mutations in any environment
  // that omits it — a security control failing closed on legitimate traffic.
  const fromUrl = request.nextUrl?.host?.toLowerCase();
  if (fromUrl) return fromUrl;
  return request.headers.get("host")?.toLowerCase() ?? null;
}

/** The host of the value we will compare: `Origin`, else `Referer`. */
function presentedOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function isCrossSiteMutation(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  // CSRF is an ambient-credentials problem: a browser attaches cookies for us.
  // A request with no cookie has nothing to forge with, and this is what keeps
  // native clients and service callers working.
  if (!request.headers.get("cookie")) return false;
  if (hasSharedSecret(request)) return false;
  const path = request.nextUrl.pathname;
  if (CSRF_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;

  const presented = presentedOrigin(request);
  // A cookie-authenticated mutation with no origin at all is refused: we cannot
  // tell it apart from a cross-site form post that hid the header, and every
  // browser sends one.
  if (!presented) return true;

  let host: string;
  try {
    host = new URL(presented).host.toLowerCase();
  } catch {
    return true;
  }

  const own = requestHost(request);
  if (own && host === own) return false;

  // A proxy (the Cloudflare worker) or a preview deployment can present the
  // canonical origin instead of the internal host, so the configured app origin
  // is accepted too.
  for (const candidate of [process.env.NEXT_PUBLIC_APP_URL, process.env.APP_URL]) {
    if (!candidate) continue;
    try {
      if (new URL(candidate).host.toLowerCase() === host) return false;
    } catch {
      // An unparseable configuration value must not open the door.
    }
  }
  return true;
}

function rateLimitedResponse(retryAfterSeconds: number, requestId: string, message?: string) {
  return NextResponse.json(errorPayload("RATE_LIMITED", message, [], requestId), {
    status: 429,
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

function requestIdOf(request: NextRequest): string {
  const supplied = request.headers.get("x-request-id")?.trim();
  if (supplied && /^[A-Za-z0-9._:-]{8,64}$/.test(supplied)) return supplied;
  return crypto.randomUUID();
}

export async function proxy(request: NextRequest) {
  const requestId = requestIdOf(request);

  if (isCrossSiteMutation(request)) {
    return NextResponse.json(
      errorPayload("FORBIDDEN", "This request did not come from the application", [], requestId),
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const identity = await resolveRateIdentity(request);

    const matchedKey = Object.entries(RATE_LIMIT_NAMES).find(([, path]) =>
      request.nextUrl.pathname.startsWith(path)
    )?.[0] as LimitKey | undefined;

    if (matchedKey) {
      const rule = resolveRule(matchedKey);
      // `limit` is raised below for authenticated drafts; the window is fixed.
      let limit = rule.limit;
      const windowMs = rule.windowMs;

      // Authenticated creators drafting stories get a higher ceiling:
      // the studio auto-saves on every keystroke burst, and 30 POSTs/min
      // is easily exhausted during active writing. Anonymous visitors keep
      // the default to prevent abuse.
      const isAuthenticated = identity.key.startsWith("uid:");
      if (isAuthenticated && matchedKey === "POSTS" && request.method === "POST") {
        limit = Math.max(limit, 120);
      }

      // Use the distributed Redis-backed rate limiter when available.
      const result = await checkRateLimit(identity.key, limit, windowMs).catch(() => null);
      if (result?.limited) {
        return rateLimitedResponse(result.resetAfter, requestId);
      }
      // Redis fallback: in-memory check for this instance only.
      if (!result && isRateLimited(identity.key, limit, windowMs)) {
        return rateLimitedResponse(windowMs / 1000, requestId);
      }

      // A caller whose address we could not verify gets a second, shared ceiling.
      // This is what makes header rotation pointless: the rotating key buys a
      // fresh per-address bucket but not a second shared one.
      if (!identity.attributed) {
        const sharedKey = `shared:${matchedKey}`;
        const sharedLimit = limit * UNATTRIBUTED_SHARED_MULTIPLIER;
        const shared = await checkRateLimit(sharedKey, sharedLimit, windowMs).catch(() => null);
        if (shared?.limited) {
          return rateLimitedResponse(shared.resetAfter, requestId, "Too many requests from this network");
        }
        if (!shared && isRateLimited(sharedKey, sharedLimit, windowMs)) {
          return rateLimitedResponse(windowMs / 1000, requestId, "Too many requests from this network");
        }
      }
    } else {
      const { limit, windowMs } = defaultApiLimit();
      if (isRateLimited(identity.key, limit, windowMs)) {
        return rateLimitedResponse(windowMs / 1000, requestId);
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
