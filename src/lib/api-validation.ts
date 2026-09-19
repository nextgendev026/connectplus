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
 * with a 400 status and a structured error payload. The caller checks the
 * return type once and then proceeds with typed data.
 *
 * Why this exists:
 *   1. Every route used to call `req.json()` and then discover the shape was
 *      wrong halfway through the handler — which is a 500, not a 400.
 *   2. Zod errors are rich ("title is too long", not "invalid input") but
 *      raw Zod output is not a clean API response. This formats them into
 *      `{ error: "Validation failed", details: [...] }`.
 *   3. The `transform` step (trimming, coercing) means the handler never has
 *      to do cleanup on input — it receives data that is already shaped the
 *      way the database expects it.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { type ZodSchema, ZodError } from "zod";

/** The shape every validation error response follows. */
export interface ValidationErrorResponse {
  error: string;
  details: {
    path: string[];
    message: string;
    code: string;
  }[];
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
): Promise<T | NextResponse<ValidationErrorResponse>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON",
        details: [{ path: [], message: "Request body must be valid JSON", code: "parse_error" }],
      },
      { status: 400 }
    );
  }

  try {
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Validation failed",
          details: error.issues.map((e) => ({
            path: e.path.map(String),
            message: e.message,
            code: e.code,
          })),
        },
        { status: 400 }
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
): T | NextResponse<ValidationErrorResponse> {
  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  try {
    return schema.parse(params);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          error: "Invalid query parameters",
          details: error.issues.map((e) => ({
            path: e.path.map(String),
            message: e.message,
            code: e.code,
          })),
        },
        { status: 400 }
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
): result is NextResponse<ValidationErrorResponse> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime type guard
  return result instanceof NextResponse && result.status === 400;
}
