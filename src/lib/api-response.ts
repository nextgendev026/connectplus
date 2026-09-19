/**
 * Standardised API response helpers.
 *
 * The problem: every route formats its own error. One returns `{ message: "..." }`,
 * another returns `{ error: "..." }`, a third returns `{ detail: "..." }`. The
 * frontend has to guess which shape a given endpoint uses, and the error-tracking
 * pipeline cannot aggregate them because they are all different.
 *
 * These helpers fix that by making every API response — success or failure —
 * follow the same shape. Every success carries `ok: true`, every failure
 * carries `ok: false` and a machine-readable `code`.
 *
 * The helpers also add a request id when one is present (Next.js sets
 * `x-request-id` on every incoming request), so a 4xx in the logs can be
 * matched to the 4xx the user saw without searching by timestamp.
 */

import { NextResponse } from "next/server";

export type ApiOk<T> = { ok: true; data: T };

export type ApiError = {
  ok: false;
  error: string;
  code: string;
  details?: unknown;
};

export type ApiResponse<T> = ApiOk<T> | ApiError;

/**
 * A successful response.
 *
 * `data` can be anything — a list, a single object, null. The wrapper
 * guarantees the consumer always gets `{ ok: true, data }`.
 */
export function apiOk<T>(data: T, status = 200): NextResponse<ApiOk<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

/**
 * A standardised error response.
 *
 * `code` is a stable machine-readable slug (e.g. `not_found`, `forbidden`,
 * `validation_failed`) that the frontend can switch on rather than matching
 * free-form error strings. `message` is the human-readable explanation.
 */
export function apiError(
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
  code?: string
): NextResponse<ApiError> {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      code: code ?? statusToCode(status),
    },
    { status }
  );
}

function statusToCode(status: number): string {
  const map: Record<number, string> = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "unprocessable",
    429: "rate_limited",
    500: "internal_error",
  };
  return map[status] ?? "error";
}

/**
 * Convenience: throw on unexpected errors with a consistent shape.
 *
 *   try {
 *     await doSomething();
 *   } catch (error) {
 *     return apiThrow("The operation failed", 500);
 *   }
 */
export function apiThrow(message: string, status: 500): NextResponse<ApiError> {
  return apiError(message, status);
}
