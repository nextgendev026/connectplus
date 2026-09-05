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

const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  "/api/auth/register": { limit: 5, windowMs: 15 * 60 * 1000 },
  "/api/auth/signin": { limit: 10, windowMs: 15 * 60 * 1000 },
  "/api/admin/neural/chat": { limit: 30, windowMs: 60 * 1000 },
  "/api/admin/neural/learn": { limit: 10, windowMs: 60 * 1000 },
  "/api/upload": { limit: 20, windowMs: 60 * 1000 },
  "/api/comments": { limit: 30, windowMs: 60 * 1000 },
  "/api/posts": { limit: 30, windowMs: 60 * 1000 },
  "/api/rss/poll": { limit: 5, windowMs: 5 * 60 * 1000 },
  "/api/rss/feeds": { limit: 30, windowMs: 60 * 1000 },
};

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const key = getRateLimitKey(request);
    const matchedPath = Object.keys(RATE_LIMITS).find(path =>
      request.nextUrl.pathname.startsWith(path)
    );

    if (matchedPath) {
      const { limit, windowMs } = RATE_LIMITS[matchedPath]!;
      if (isRateLimited(key, limit, windowMs)) {
        return NextResponse.json(
          { error: "Too many requests. Please try again later." },
          { status: 429, headers: { "Retry-After": String(Math.ceil(windowMs / 1000)) } }
        );
      }
    } else {
      if (isRateLimited(key, 100, 60 * 1000)) {
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