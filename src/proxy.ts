import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getToken } from "next-auth/jwt";

declare global {
  var __rateLimitCleanup: boolean | undefined;
}

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

/**
 * Rate-limit key: authenticated users are keyed by user ID (stable, one per
 * account), anonymous visitors by IP. This prevents shared-IP environments
 * (NAT, corporate networks, VPNs) from merging unrelated users into one
 * counter — which is the root cause of "Too many requests" when a logged-in
 * writer saves drafts from behind a shared IP.
 */
async function getRateLimitKey(request: NextRequest): Promise<string> {
  const token = await getToken({ req: request as any, secret: process.env.AUTH_SECRET }).catch(() => null);
  if (token?.sub) return `uid:${token.sub}:${request.nextUrl.pathname}`;
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "anonymous";
  return `${ip}:${request.nextUrl.pathname}`;
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
};

export const DEFAULT_API_LIMIT = 100;
export const DEFAULT_API_WINDOW_MS = 60 * 1000;

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

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const key = await getRateLimitKey(request);
    const isAuthenticated = key.startsWith("uid:");

    const matchedKey = Object.entries(RATE_LIMIT_NAMES).find(([, path]) =>
      request.nextUrl.pathname.startsWith(path)
    )?.[0] as LimitKey | undefined;

    if (matchedKey) {
      let { limit, windowMs } = resolveRule(matchedKey);

      // Authenticated creators drafting stories get a higher ceiling:
      // the studio auto-saves on every keystroke burst, and 30 POSTs/min
      // is easily exhausted during active writing. Anonymous visitors keep
      // the default to prevent abuse.
      if (isAuthenticated && matchedKey === "POSTS" && request.method === "POST") {
        limit = Math.max(limit, 120);
      }

      // Use the distributed Redis-backed rate limiter when available.
      const result = await checkRateLimit(key, limit, windowMs).catch(() => null);
      if (result?.limited) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429, headers: { "Retry-After": String(result.resetAfter) } }
        );
      }
      // Redis fallback: in-memory check for this instance only.
      if (!result && isRateLimited(key, limit, windowMs)) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) } }
        );
      }
    } else {
      const { limit, windowMs } = defaultApiLimit();
      if (isRateLimited(key, limit, windowMs)) {
        return NextResponse.json(
          { error: "Too many requests." },
          { status: 429 }
        );
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};