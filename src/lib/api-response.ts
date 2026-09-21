/**
 * @deprecated Superseded by `@/lib/contracts` (successes) and `@/lib/errors`
 * (failures). Kept as a thin shim so the file cannot circulate a *third*
 * response shape: both functions below now emit the same envelope every
 * `/api/v1` route emits.
 *
 * The history is worth keeping. This module was written to unify error shapes
 * and then never imported — so the repo ended up with its own intent recorded in
 * a file nothing used, while 396 call sites hand-rolled `{ error: "..." }`
 * anyway. A shared helper that nobody calls is not a standard; a shape enforced
 * by a wrapper (see `apiHandler`) is. New code should not import this file.
 */

import { NextResponse } from "next/server";
import { type ApiErrorCode, errorPayload, ERROR_STATUS } from "@/lib/errors";
import { anonymousContext } from "@/lib/request-context";
import { okResponse, type ApiOkPayload } from "@/lib/contracts";

export type ApiOk<T> = ApiOkPayload<T>;

/** @deprecated Use `okResponse(data, ctx)` from `@/lib/contracts`. */
export function apiOk<T>(data: T, status = 200): NextResponse<ApiOkPayload<T>> {
  return okResponse(data, anonymousContext(), { status });
}

/**
 * @deprecated Prefer throwing an `AppError` from `@/lib/errors` and letting
 * `apiHandler` shape the response. This exists for callers that must *return* a
 * failure rather than throw one.
 */
export function apiError(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
  code?: string
): NextResponse<ReturnType<typeof errorPayload>> {
  // Map the legacy status-first signature onto the code-first vocabulary, so the
  // two entry points cannot disagree about what a 403 is called.
  const mapped: ApiErrorCode =
    code && (code.toUpperCase() in ERROR_STATUS)
      ? (code.toUpperCase() as ApiErrorCode)
      : STATUS_CODES[status] ?? "INTERNAL_ERROR";

  return NextResponse.json(
    errorPayload(mapped, message, [], anonymousContext().requestId),
    { status }
  );
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: "VALIDATION_ERROR",
  401: "AUTHENTICATION_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};
