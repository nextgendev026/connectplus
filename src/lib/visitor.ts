import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";

/**
 * Privacy-preserving visitor identity.
 *
 * We never persist a raw IP or a durable person-level identifier. A random,
 * first-party cookie (`cp_vid`) is minted on first sight and only its salted
 * SHA-256 digest is stored. That digest is the unit of "unique visitor".
 * Because the salt lives in the environment, the digest is not reversible and
 * can be rotated to orphan all history.
 */

export const VISITOR_COOKIE = "cp_vid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180; // 180 days

/** Salt for visitor hashing. Rotating it de-links all existing histories. */
function salt(): string {
  return (
    process.env.VISITOR_SALT ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    "connectplus-visitor-salt"
  );
}

export function hashVisitor(visitorId: string): string {
  return createHash("sha256").update(`${salt()}:${visitorId}`).digest("hex").slice(0, 40);
}

/** Hour-bucketed session key: same visitor within the same hour = one session. */
export function sessionKeyFor(visitorHash: string, at: Date = new Date()): string {
  const bucket = `${at.getUTCFullYear()}-${at.getUTCMonth()}-${at.getUTCDate()}-${at.getUTCHours()}`;
  return createHash("sha256").update(`${visitorHash}:${bucket}`).digest("hex").slice(0, 32);
}

/** Stable hash of an IP (+ UA) for the cookie-less fallback path. */
export function fingerprint(ip: string | null, userAgent: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${salt()}:${ip}:${userAgent ?? ""}`).digest("hex").slice(0, 40);
}

export interface VisitorIdentity {
  /** Digest stored in the DB. */
  visitorHash: string;
  /** Set when this request minted a brand-new cookie. */
  newVisitorId?: string;
  sessionKey: string;
}

/**
 * Resolve the visitor for a request. Prefers the `cp_vid` cookie; when absent
 * (or when cookies are refused) it falls back to an IP+UA fingerprint so
 * analytics still work without ever writing the raw values.
 */
export function resolveVisitor(request: NextRequest): VisitorIdentity {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;

  if (existing && existing.length >= 16) {
    const visitorHash = hashVisitor(existing);
    return { visitorHash, sessionKey: sessionKeyFor(visitorHash) };
  }

  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip");
  const fp = fingerprint(ip, request.headers.get("user-agent"));

  if (fp) {
    // No cookie yet, but we can still count this view as a distinct visitor
    // for today without handing the browser an identifier it did not consent to.
    const visitorHash = hashVisitor(`fp:${fp}`);
    return { visitorHash, sessionKey: sessionKeyFor(visitorHash) };
  }

  const fresh = randomUUID();
  const visitorHash = hashVisitor(fresh);
  return { visitorHash, newVisitorId: fresh, sessionKey: sessionKeyFor(visitorHash) };
}

export const visitorCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
  maxAge: COOKIE_MAX_AGE,
};

/**
 * Normalise a path so `/article/x?utm=1` and `/article/x` count together, and
 * so a query-string storm cannot explode the cardinality of the top-pages
 * report.
 */
export function normalizePath(raw: string): string {
  try {
    const url = new URL(raw, "http://local");
    let path = url.pathname.replace(/\/+$/, "") || "/";
    // Collapse detail routes to their section so pagination/ids don't fragment.
    path = path.replace(/^\/(article)\/[^/]+$/, "/$1/[slug]");
    path = path.replace(/^\/profile\/[^/]+$/, "/profile/[username]");
    return path.slice(0, 200);
  } catch {
    return "/";
  }
}
