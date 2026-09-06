import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

declare global {
  var __rateLimitCleanup: boolean | undefined;
}

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function getRateLimitKey(request: NextRequest): string {
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

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const key = getRateLimitKey(request);

    const matchedKey = Object.entries(RATE_LIMIT_NAMES).find(([, path]) =>
      request.nextUrl.pathname.startsWith(path)
    )?.[0] as LimitKey | undefined;

    if (matchedKey) {
      const { limit, windowMs } = resolveRule(matchedKey);
      if (isRateLimited(key, limit, windowMs)) {
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