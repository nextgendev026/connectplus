/**
 * The sentence to show a person when an API call failed.
 *
 * Two bodies are in flight at once: the legacy routes answer
 * `{ error: "Text" }` while the shared envelope (`./index`) answers
 * `{ error: { code, message, details, requestId } }`. Call sites that did
 * `new Error(err.error)` coerced the second shape with `String()`, so a writer
 * watching a publish fail was told `[object Object]` instead of the reason —
 * which is how a Cloudflare-edge 403 stayed invisible for as long as it did.
 *
 * Kept dependency-free on purpose: this runs in client components, so it may not
 * import the envelope module (which pulls in the logger and `NextResponse`).
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const { error, message } = body as { error?: unknown; message?: unknown };
  // Legacy shape: the error IS the text.
  if (typeof error === "string" && error.trim()) return error;
  // Envelope shape: the text (and a machine code worth showing for support)
  // live inside it.
  if (typeof error === "object" && error !== null) {
    const nested = error as { message?: unknown; code?: unknown };
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
    if (typeof nested.code === "string" && nested.code.trim()) return nested.code;
  }
  // A few hand-rolled routes answer `{ message }` instead.
  if (typeof message === "string" && message.trim()) return message;
  return fallback;
}
