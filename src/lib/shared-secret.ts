import type { NextRequest } from "next/server";

/**
 * The shared-secret check every scheduler and drain endpoint makes.
 *
 * This comparison used to be copy-pasted into six routes, all of them as
 * `value === secret`, and in each one it is the *entire* authorisation story for
 * an endpoint that runs jobs, drains the RSS registry or streams an operation's
 * progress. Two properties matter, and neither of them survives being
 * copy-pasted:
 *
 *  1. **The compare is constant time.** `===` on strings short-circuits at the
 *     first differing byte, so "is this the secret?" becomes an oracle that
 *     leaks the secret a byte at a time to anyone able to measure the response
 *     time. `timingSafeEqual` compares the whole buffer every time.
 *  2. **A missing secret is a refusal, never a pass.** Several call sites only
 *     compared when the env var was set (`if (secret && …)`), which is the right
 *     instinct but leaves the endpoint's real gate to a try/catch downstream.
 *     Here an unset `CRON_SECRET` answers `false`, full stop — a deployment that
 *     forgot the variable has a closed endpoint, not an open one.
 *
 * Carriers: `Authorization: Bearer <secret>`, `x-cron-secret: <secret>`, and
 * `?key=` / `?secret=<secret>`. The query form is deliberately kept because
 * cron-job.org and `scripts/cronjob-sync.mjs` are configured with it in
 * production — but it is the weakest of the three (a URL ends up in access logs,
 * browser history and `Referer` headers), so treat a query secret as a
 * credential that must be rotated if it ever leaks.
 *
 * Callers add their own admin-session fallback on top; this module only answers
 * "did the shared secret arrive, and is it right?".
 */

/**
 * Compare two strings without leaking their contents through timing.
 *
 * Hand-rolled from `TextEncoder` rather than `node:crypto`, because this module
 * is reached from the Edge middleware: the edge bundler (webpack, which CI
 * builds with) refuses `node:crypto` outright — "UnhandledSchemeError: Reading
 * from node:crypto is not handled by plugins" — and `node:crypto` is not part of
 * the edge runtime anyway. `TextEncoder` is a platform global in both runtimes,
 * so the same code is correct on the Node server and on the edge.
 *
 * The loop XORs every byte into one accumulator with no early exit, which is the
 * property that matters: a difference anywhere produces the same non-zero result
 * and the same work, so the comparison time does not reveal *where* the bytes
 * first differ. The length check short-circuits, which is safe — length is not
 * the secret.
 */
function equal(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i]! ^ right[i]!;
  }
  return diff === 0;
}

/** True when this single value is the configured shared secret. */
export function isSharedSecret(candidate: string | null | undefined): boolean {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (!secret || !candidate) return false;
  const value = candidate.trim();
  // An Authorization header carries the secret behind a scheme; the other
  // carriers (and the existing cron-job.org config) send it bare.
  const bearer = /^Bearer[ \t]+(.+)$/i.exec(value)?.[1];
  return equal((bearer ?? value).trim(), secret);
}

/** True when a request presents the shared secret in any supported carrier. */
export function hasSharedSecret(request: NextRequest): boolean {
  if (isSharedSecret(request.headers.get("authorization"))) return true;
  if (isSharedSecret(request.headers.get("x-cron-secret"))) return true;
  if (isSharedSecret(request.headers.get("x-rss-secret"))) return true;
  if (isSharedSecret(request.nextUrl.searchParams.get("key"))) return true;
  if (isSharedSecret(request.nextUrl.searchParams.get("secret"))) return true;
  return false;
}
