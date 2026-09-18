/**
 * Marketing copy helpers that carry NO runtime dependencies.
 *
 * Split out of `marketing.ts` for the same reason `brand.ts` exists: the admin
 * marketing console is a client component, and importing a single function from
 * `marketing.ts` dragged the whole server module — Prisma, Redis, ioredis — into
 * the browser bundle, which broke the production build outright (`Can't resolve
 * 'dns'`). This file may only ever import nothing, so a client can use it freely.
 */

/**
 * Trend subjects are extracted keywords, so they arrive lower-cased: a headline
 * that opens with "‘nairobi’ is what the region is talking about" reads like a
 * bug. Capitalising is not cosmetic here — it is the difference between copy an
 * operator will approve and copy they will delete.
 */
export function readableSubject(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
