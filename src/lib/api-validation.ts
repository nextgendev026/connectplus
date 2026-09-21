/**
 * Validation middleware for Next.js App Router API routes.
 *
 * Usage:
 *   import { validateBody } from "@/lib/api-validation";
 *   import { CreatePostSchema } from "@/lib/schemas/validators";
 *
 *   export async function POST(req: NextRequest) {
 *     const body = await validateBody(req, CreatePostSchema);
 *     if (body instanceof NextResponse) return body; // 400 error
 *     // body is now a typed CreatePostInput
 *   }
 *
 * The function returns either the parsed and validated data, or a NextResponse
 * with a 400 status and the shared error envelope. The caller checks the return
 * type once and then proceeds with typed data.
 *
 * Why this exists:
 *   1. Every route used to call `req.json()` and then discover the shape was
 *      wrong halfway through the handler — which is a 500, not a 400.
 *   2. Zod errors are rich ("title is too long", not "invalid input"), but raw
 *      Zod output is not a clean API response. This maps each issue onto the
 *      contract's `details[]` so a client renders the same way for every route.
 *   3. The `transform` step (trimming, coercing) means the handler never has
 *      to do cleanup on input — it receives data that is already shaped the
 *      way the database expects it.
 *
 * The response shape is not decided here: it comes from `@/lib/errors`, which is
 * the single definition of what a failure looks like. Before that module existed,
 * this file was one of four places that answered 400 differently.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { type ZodSchema, ZodError } from "zod";
import { errorPayload, type ApiErrorDetail, type ApiErrorPayload } from "@/lib/errors";
import { readRequestId } from "@/lib/request-context";

/** The shape every validation failure returns. Aliased for existing callers. */
export type ValidationErrorResponse = ApiErrorPayload;

/** Map Zod issues onto the contract's detail rows. */
function detailRows(error: ZodError): ApiErrorDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
  }));
}

function invalid(
  req: NextRequest,
  code: "parse_error" | "validation_failed",
  message: string,
  details: ApiErrorDetail[],
  errorCode: "VALIDATION_ERROR"
): NextResponse<ApiErrorPayload> {
  // `errorCode` is always VALIDATION_ERROR today; it is named here so the two
  // call sites read identically and a future taxonomy change is one edit.
  return NextResponse.json(errorPayload(errorCode, message, details, readRequestId(req)), {
    status: 400,
    headers: { "Cache-Control": "no-store" },
  }) as NextResponse<ApiErrorPayload>;
}

/**
 * Parse and validate the request body against a Zod schema.
 *
 * Returns the validated data on success, or a 400 NextResponse on failure.
 * The 400 is returned, not thrown, because throwing inside a catch block
 * would lose the structured error information.
 */
export async function validateBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>
): Promise<T | NextResponse<ApiErrorPayload>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return invalid(
      req,
      "parse_error",
      "The request body must be valid JSON",
      [{ path: [], message: "Request body must be valid JSON", code: "parse_error" }],
      "VALIDATION_ERROR"
    );
  }

  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return invalid(
        req,
        "validation_failed",
        "The request is invalid",
        detailRows(error),
        "VALIDATION_ERROR"
      );
    }
    throw error;
  }
}

/**
 * Validate a query parameter (search params).
 *
 * Same contract as `validateBody` but reads from `req.nextUrl.searchParams`.
 */
export function validateSearchParams<T>(
  req: NextRequest,
  schema: ZodSchema<T>
): T | NextResponse<ApiErrorPayload> {
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  try {
    return schema.parse(params);
  } catch (error) {
    if (error instanceof ZodError) {
      return invalid(
        req,
        "validation_failed",
        "The query parameters are invalid",
        detailRows(error),
        "VALIDATION_ERROR"
      );
    }
    throw error;
  }
}

/**
 * A type guard that checks if a response is a validation error.
 *
 * After calling `validateBody` or `validateSearchParams`, use this to narrow
 * the type:
 *
 *   const body = await validateBody(req, Schema);
 *   if (isValidationError(body)) return body;
 *   // body is now the validated type
 */
export function isValidationError(
  result: unknown
): result is NextResponse<ApiErrorPayload> {
  return result instanceof NextResponse && result.status === 400;
}
