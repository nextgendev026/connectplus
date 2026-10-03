/**
 * The pure half of the save ledger, split out so the Studio's client bundle can
 * import it.
 *
 * `save-ledger.ts` owns the database side and therefore imports the Prisma
 * client. The Studio composer is a `"use client"` component that needs only
 * `saveIdempotencyKey`, but importing it from that module pulled the whole
 * Prisma → `pg` graph into the browser bundle — which fails the Cloudflare build
 * outright (`pg` needs `net`/`fs`, which no edge or browser runtime provides) and
 * would have shipped a database driver to visitors.
 *
 * Keeping the key derivation here, with no imports at all, is the fix: the
 * formula is shared by the server and the client, and neither has to carry the
 * other's dependencies.
 */

/**
 * How long a claim protects a save attempt.
 *
 * Generous relative to the operation it guards — a create takes milliseconds —
 * because the cost of being wrong is asymmetric. Too short and a retry after a
 * slow request creates a duplicate, which is the bug. Too long and a writer who
 * abandons a draft and starts a genuinely new one within the window could have
 * their new draft answered with the old one; ten minutes makes that require
 * abandoning a draft and re-typing it to the same revision and hash, which is the
 * same document by definition.
 */
export const CLAIM_WINDOW_MS = 10 * 60 * 1000;

/**
 * The idempotency key for a save.
 *
 * Derived from the session, the revision and the document hash, so an identical
 * retry of the same intent produces the same key while a new edit produces a new
 * one. A key including only the session would make every save after the first
 * look like a retry; a random key would make every retry look like a first save.
 */
export function saveIdempotencyKey(input: {
  sessionId: string;
  revision: number;
  contentHash: string;
}): string {
  return `${input.sessionId}:${input.revision}:${input.contentHash.slice(0, 24)}`;
}

/**
 * Read the idempotency key a caller sent, if any.
 *
 * Both spellings are accepted and the value is validated: this header reaches
 * the database as part of a primary key, so an unbounded or oddly-shaped
 * arbitrary header is not a safe thing to put there.
 */
export function readIdempotencyKey(request: { headers: { get(name: string): string | null } }): string | null {
  const raw = request.headers.get("idempotency-key") ?? request.headers.get("x-idempotency-key");
  if (!raw) return null;
  const key = raw.trim();
  if (key.length < 8 || key.length > 200) return null;
  if (!/^[A-Za-z0-9:_-]+$/.test(key)) return null;
  return key;
}
