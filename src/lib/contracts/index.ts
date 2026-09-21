import { NextResponse } from "next/server";
import { type ZodSchema, ZodError } from "zod";
import { AppError, apiErrorResponse, internalError, type ApiErrorDetail } from "@/lib/errors";
import { requestContext, type RequestContext } from "@/lib/request-context";

/**
 * The contract every `/api/v1` response follows.
 *
 * Version 0 of this API is 111 route handlers that each invented their own
 * success shape: some return an array, some `{ posts, total }`, some
 * `{ notifications, unreadCount }`, some a bare string. A client cannot be
 * written against that without a lookup table, and a second client means writing
 * the table twice.
 *
 * Version 1 has one shape:
 *
 *   success →  { data: <T>, meta: { requestId, timestamp, apiVersion }, pagination? }
 *   failure →  { error: { code, message, details, requestId } }
 *
 * The two are disjoint (`data` xor `error`), so a client branches once.
 *
 * Why a wrapper and not a convention: `apiHandler` is what makes the guarantee
 * real. A route that forgets to try/catch, or throws a Prisma error out of a
 * `findMany`, still answers with an envelope and a request id rather than a bare
 * stack — because the catch lives in one place instead of 111.
 *
 * `/api/v1` is introduced *alongside* the existing routes. Nothing is moved:
 * every current client keeps working while new consumers adopt v1 route by route.
 */

export const API_VERSION = "1";

export interface ApiMeta {
  /** Correlate a user report with a log line. Always present. */
  requestId: string;
  /** ISO-8601. Lets a client tell a cached body from a fresh one. */
  timestamp: string;
  apiVersion: string;
}

export interface ApiOkPayload<T> {
  data: T;
  meta: ApiMeta;
}

/** Cursor pagination. `nextCursor === null` means "this is the last page". */
export interface PageInfo {
  limit: number;
  /** Rows returned in this page; not the total in the collection. */
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface ApiPagePayload<T> {
  data: T[];
  pagination: PageInfo;
  meta: ApiMeta;
}

export interface ResponseInitOptions {
  status?: number;
  headers?: Record<string, string>;
}

export function apiMeta(ctx: RequestContext): ApiMeta {
  return { requestId: ctx.requestId, timestamp: new Date().toISOString(), apiVersion: API_VERSION };
}

/** Success: a single object (or `null`). */
export function okResponse<T>(
  data: T,
  ctx: RequestContext,
  init: ResponseInitOptions = {}
): NextResponse<ApiOkPayload<T>> {
  return NextResponse.json(
    { data, meta: apiMeta(ctx) },
    { status: init.status ?? 200, headers: init.headers }
  );
}

/** Success: a page of objects. */
export function paginatedResponse<T>(
  data: T[],
  ctx: RequestContext,
  pagination: Omit<PageInfo, "count">,
  init: ResponseInitOptions = {}
): NextResponse<ApiPagePayload<T>> {
  return NextResponse.json(
    { data, pagination: { ...pagination, count: data.length }, meta: apiMeta(ctx) },
    { status: init.status ?? 200, headers: init.headers }
  );
}

/**
 * Headers for a response that must never be stored by a shared cache.
 *
 * Reader-scoped data (notifications, drafts, a subscription) is per-person, and
 * a cached copy served to the next caller is indistinguishable from a data leak.
 * This is exported so the choice is one call rather than four remembered header
 * names — and so Phase F's cache-privacy tests have something to assert on.
 */
export const NO_STORE = { "Cache-Control": "no-store, no-cache, must-revalidate" } as const;

/** Attach identity to a context that was resolved anonymously. */
export function withIdentity(
  ctx: RequestContext,
  identity: { actorId?: string | null; sessionId?: string | null }
): RequestContext {
  return {
    ...ctx,
    actorId: identity.actorId ?? ctx.actorId,
    sessionId: identity.sessionId ?? ctx.sessionId,
  };
}

/* ── Cursors ───────────────────────────────────────────────────────────────── */

/**
 * Encode a cursor.
 *
 * Opaque on purpose: a cursor is a continuation token, not an API. A client that
 * constructs one is relying on an implementation detail, so making it opaque now
 * means the keyset can change later (id → createdAt+id, or a different ordering)
 * without a breaking change.
 */
export function encodeCursor(value: Record<string, string>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Decode a cursor, defensively.
 *
 * A cursor arrives from the network, so this never throws and never trusts its
 * shape: a malformed, oversized or hostile value is `null`, which a route treats
 * as "start from the beginning" rather than as a 500. The size cap matters
 * because base64 of a large blob is a cheap way to make the server allocate.
 */
export function decodeCursor(raw: string | null | undefined): Record<string, string> | null {
  if (!raw || raw.length > 512) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string" || value.length > 128) return null;
      out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** A `limit` query parameter, clamped so a client cannot ask for the table. */
export function readLimit(
  searchParams: URLSearchParams,
  fallback = 20,
  max = 50
): number {
  const parsed = Number.parseInt(searchParams.get("limit") ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

/* ── Response validation ───────────────────────────────────────────────────── */

/**
 * Validate a DTO against its own contract before it leaves the server.
 *
 * A route that returns a field the schema does not declare — because a query
 * spread a row, or a `select` was widened — is a contract break that no client
 * test catches. Failing here turns it into a 500 with a log line naming the field,
 * which is loud and fixable, instead of a slow client-side `undefined`.
 *
 * Returns the parsed value (so `transform`/`strip` still apply) or throws an
 * `INTERNAL_ERROR`: a response that violates its own contract is a server bug, not
 * a client error, and must never be answered with a 4xx.
 */
export function validateResponse<T>(schema: ZodSchema<T>, data: unknown, label: string): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof ZodError) {
      const details: ApiErrorDetail[] = error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
        code: issue.code,
      }));
      throw new AppError("INTERNAL_ERROR", undefined, { details, cause: { label } });
    }
    throw internalError(error);
  }
}

/* ── The handler wrapper ───────────────────────────────────────────────────── */

/**
 * A route body that has a request context and may throw.
 *
 * Throw an `AppError` (or one of the constructors from `@/lib/errors`) to answer
 * with a specific status; throw anything else and the wrapper answers 500 with no
 * detail disclosed.
 */
export type ApiHandler = (req: Request, ctx: RequestContext) => Promise<Response>;

/**
 * Wrap a route handler so its failures are contract-shaped.
 *
 * Note what this does *not* do: it does not resolve a session. A public read
 * should not pay for an auth lookup to be well-described, so a route that needs
 * identity calls `requireSessionContext`/`auth()` itself and passes the result
 * through `withIdentity`.
 */
export function apiHandler(handler: ApiHandler) {
  return async (req: Request): Promise<Response> => {
    const ctx = requestContext(req as never);
    try {
      return await handler(req, ctx);
    } catch (error) {
      return apiErrorResponse(error, ctx.requestId);
    }
  };
}
