import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

/**
 * One error vocabulary for the whole API.
 *
 * Before this module the API answered failures 396 different ways: a bare
 * `{ error: "Unauthorized" }` here, `{ error, details }` there, `{ message }`
 * somewhere else. A client could not tell "you are not signed in" from "you are
 * not allowed" without matching English prose, and the error-tracking pipeline
 * could not aggregate anything, because no two failures were shaped alike.
 *
 * Three rules are enforced here rather than trusted to each route:
 *
 *  1. **The code is a closed set.** `ApiErrorCode` is a union, not a string, so a
 *     typo is a compile error and a client can switch on it exhaustively.
 *  2. **Unexpected failures never disclose.** A thrown Prisma error carries a
 *     connection string fragment, a query and a stack. Only codes whose message
 *     *we* author are surfaced; everything else collapses to `INTERNAL_ERROR`
 *     with a generic sentence, and the detail goes to the log with the request id
 *     instead. A stack trace in a response body is an information leak, and this
 *     is the single place that can guarantee there is never one.
 *  3. **A request id always comes back.** Every payload carries one, so a user's
 *     screenshot maps to a log line without guessing by timestamp.
 */

const log = createLogger("api-errors");

/**
 * The complete set of machine-readable failure codes.
 *
 * Chosen to map 1:1 onto distinguishable HTTP statuses, so a client can act on
 * `code` alone: retry after a delay (RATE_LIMITED / PROVIDER_*), re-authenticate
 * (AUTHENTICATION_REQUIRED), give up (FORBIDDEN / NOT_FOUND), or fix the request
 * (VALIDATION_ERROR).
 */
export const API_ERROR_CODES = [
  "VALIDATION_ERROR",
  "AUTHENTICATION_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "DATABASE_UNAVAILABLE",
  "INTERNAL_ERROR",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Code → status.
 *
 * `PROVIDER_TIMEOUT` is 504 (we were the gateway and the upstream ran out of
 * time) while `PROVIDER_UNAVAILABLE` and `DATABASE_UNAVAILABLE` are 503 (the
 * dependency is down): the distinction matters because the first suggests a
 * retry may help and the second suggests backing off.
 */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  AUTHENTICATION_REQUIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

/**
 * The default sentence for each code.
 *
 * Deliberately written to be safe to show a user and useless to an attacker:
 * no hostnames, no table names, no upstream provider names.
 */
export const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: "The request is invalid",
  AUTHENTICATION_REQUIRED: "Authentication is required",
  FORBIDDEN: "You do not have permission to do that",
  NOT_FOUND: "The requested resource was not found",
  CONFLICT: "The request conflicts with the current state",
  RATE_LIMITED: "Too many requests. Please try again later.",
  PROVIDER_TIMEOUT: "The upstream service did not respond in time",
  PROVIDER_UNAVAILABLE: "The upstream service is unavailable",
  DATABASE_UNAVAILABLE: "The service is temporarily unavailable",
  INTERNAL_ERROR: "Something went wrong",
};

/**
 * Codes whose message is never surfaced, whatever the caller passed.
 *
 * An `INTERNAL_ERROR` built as `new AppError("INTERNAL_ERROR", error.message)`
 * looks harmless at the call site and prints a Prisma connection string to the
 * client. Rather than trusting every future call site to phrase it carefully,
 * these two codes always answer with `DEFAULT_MESSAGES`, and the real text is
 * logged.
 */
const NEVER_DISCLOSE: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "INTERNAL_ERROR",
  "DATABASE_UNAVAILABLE",
]);

/** One field-level problem inside a VALIDATION_ERROR. */
export interface ApiErrorDetail {
  /** Dotted path to the offending field; `[]` for a whole-body problem. */
  path: string[];
  message: string;
  /** Machine-readable sub-code, e.g. a Zod issue code. */
  code?: string;
}

/** The exact body every failure returns. */
export interface ApiErrorPayload {
  error: {
    code: ApiErrorCode;
    message: string;
    details: ApiErrorDetail[];
    requestId: string;
  };
}

export type ApiErrorResponse = NextResponse<ApiErrorPayload>;

export interface AppErrorOptions {
  details?: ApiErrorDetail[];
  /** Seconds until the caller may retry; sets `Retry-After`. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * An error a route raises deliberately, carrying the code it should answer with.
 *
 * Anything else thrown out of a handler is treated as a bug and answered as
 * `INTERNAL_ERROR` — which is why `apiHandler` does not need every route to
 * remember its own try/catch.
 */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: ApiErrorDetail[];
  readonly retryAfterSeconds: number | null;
  /** True when this message may be shown to the caller. */
  readonly disclosable: boolean;

  constructor(code: ApiErrorCode, message?: string, options: AppErrorOptions = {}) {
    const disclosable = !NEVER_DISCLOSE.has(code);
    super(disclosable && message ? message : DEFAULT_MESSAGES[code]);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = options.details ?? [];
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.disclosable = disclosable;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export function statusFor(code: ApiErrorCode): number {
  return ERROR_STATUS[code];
}

/** Build the response body for a code, never leaking what it must not. */
export function errorPayload(
  code: ApiErrorCode,
  message: string | undefined,
  details: ApiErrorDetail[],
  requestId: string
): ApiErrorPayload {
  const disclosable = !NEVER_DISCLOSE.has(code);
  return {
    error: {
      code,
      message: disclosable && message ? message : DEFAULT_MESSAGES[code],
      details,
      requestId,
    },
  };
}

/**
 * Turn anything thrown into a response.
 *
 * This is the only place a failure becomes a body, so it is also the only place
 * that has to get the disclosure rule right.
 */
export function apiErrorResponse(error: unknown, requestId: string): ApiErrorResponse {
  if (error instanceof AppError) {
    // A deliberate, already-classified failure. Log at warn: if these are
    // frequent, the caller is doing something wrong and it should be visible.
    log.warn("api error", { requestId, code: error.code, status: error.status });
    const init: ResponseInit = { status: error.status };
    if (error.retryAfterSeconds !== null) {
      init.headers = { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterSeconds))) };
    }
    return NextResponse.json(
      errorPayload(error.code, error.message, error.details, requestId),
      init
    ) as ApiErrorResponse;
  }

  // Anything else is a bug. Log the whole thing (with the id a user can quote)
  // and answer with none of it.
  log.error("unhandled api error", {
    requestId,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  return NextResponse.json(
    errorPayload("INTERNAL_ERROR", undefined, [], requestId),
    { status: ERROR_STATUS.INTERNAL_ERROR }
  ) as ApiErrorResponse;
}

/* ── Constructors, so a route reads as what it means ──────────────────────── */

export function validationError(details: ApiErrorDetail[], message?: string): AppError {
  return new AppError("VALIDATION_ERROR", message, { details });
}

export function authenticationRequired(message?: string): AppError {
  return new AppError("AUTHENTICATION_REQUIRED", message);
}

export function forbidden(message?: string): AppError {
  return new AppError("FORBIDDEN", message);
}

export function notFound(message?: string): AppError {
  return new AppError("NOT_FOUND", message);
}

export function conflict(message?: string): AppError {
  return new AppError("CONFLICT", message);
}

export function rateLimited(retryAfterSeconds: number, message?: string): AppError {
  return new AppError("RATE_LIMITED", message, { retryAfterSeconds });
}

export function providerTimeout(message?: string): AppError {
  return new AppError("PROVIDER_TIMEOUT", message);
}

export function providerUnavailable(message?: string): AppError {
  return new AppError("PROVIDER_UNAVAILABLE", message);
}

export function databaseUnavailable(cause?: unknown): AppError {
  return new AppError("DATABASE_UNAVAILABLE", undefined, { cause });
}

export function internalError(cause?: unknown): AppError {
  return new AppError("INTERNAL_ERROR", undefined, { cause });
}

/**
 * The `code` a thrown error would answer with, without building a response.
 *
 * Used by tests and by the admin diagnostics that summarise failure shapes.
 */
export function codeFor(error: unknown): ApiErrorCode {
  return error instanceof AppError ? error.code : "INTERNAL_ERROR";
}
