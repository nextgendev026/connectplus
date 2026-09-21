/**
 * The draft-creation idempotency ledger.
 *
 * The Studio's duplicate-draft bug is reachable by ordinary typing: `editingId`
 * is derived from a create response, so until React commits the state update an
 * in-flight save still reads `null` and a second create is issued. The client
 * guard in `lib/studio/composer.ts` refuses a concurrent save outright, which
 * fixes the race at its source. This module covers the case a client guard
 * cannot: **a create whose response was lost on the network**, where the writer
 * (or the platform) retries an intent that already succeeded.
 *
 * The design is claim-then-complete rather than a lookup:
 *
 *   1. **Claim** — insert the key. The primary key makes this atomic, so two
 *      concurrent requests with the same key cannot both win. The loser reads the
 *      winner's row.
 *   2. **Complete** — set `postId` once the document exists.
 *   3. **Release** — delete the claim if the create failed, so a retry with the
 *      same key is allowed to proceed rather than being refused forever by a
 *      failure it has already recovered from.
 *
 * The distinction that matters is between *in flight* and *done*. A claimant that
 * finds a row with no `postId` must not create a second draft, and must not
 * return a `postId` that does not exist yet either — so it is answered with a
 * conflict, which the client turns into a short retry.
 *
 * It is deliberately **not** in Redis. `lib/cache-policy.ts` classifies anything
 * scoped to one writer as user-scoped and refuses it on a shared layer, and that
 * refusal is correct — a cache key is a string, and one missing component would
 * serve one writer the claim of another. Beyond privacy, "cannot create a
 * duplicate" has to survive a cache eviction; a ledger whose safety property
 * disappears on a memory-pressure event is not a guarantee.
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("studio-save-ledger");

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

export type ClaimResult =
  | { status: "claimed" }
  | { status: "existing"; postId: string }
  | { status: "in_flight" }
  | { status: "unavailable"; reason: string };

/**
 * The idempotency key for a save.
 *
 * Derived from the session, the revision and the document hash, so an identical
 * retry of the same intent produces the same key while a new edit produces a new
 * one. A key including only the session would make every save after the first
 * look like a retry; a random key would make every retry look like a first save.
 */
export function saveIdempotencyKey(input: { sessionId: string; revision: number; contentHash: string }): string {
  return `${input.sessionId}:${input.revision}:${input.contentHash.slice(0, 24)}`;
}

/**
 * Claim a draft-creation attempt.
 *
 * `unavailable` is a distinct outcome from `claimed` on purpose: if the ledger
 * cannot be written, the caller must decide for itself whether to proceed. It
 * should proceed — refusing every create because a bookkeeping table is
 * unreachable would turn a duplicate-prevention feature into an outage — but the
 * caller has to make that choice knowingly rather than be told "claimed".
 */
export async function claimCreate(
  userId: string,
  key: string,
  now: Date = new Date()
): Promise<ClaimResult> {
  if (!userId || !key) {
    return { status: "unavailable", reason: "a claim requires both a user and a key" };
  }

  const expiresAt = new Date(now.getTime() + CLAIM_WINDOW_MS);
  sweepInBackground(now);

  try {
    await prisma.studioSaveClaim.create({ data: { id: key, userId, expiresAt } });
    return { status: "claimed" };
  } catch (err) {
    if (!isUniqueViolation(err)) {
      // Not a race — the ledger itself is unusable. Report it rather than
      // guessing, so the route can proceed and log the degradation.
      log.error("claim write failed", { error: String(err) });
      return { status: "unavailable", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  // The insert lost, so a claim already exists. Read it to find out which kind.
  const existing = await prisma.studioSaveClaim.findUnique({
    where: { id: key },
    select: { postId: true, userId: true, expiresAt: true },
  });

  if (!existing || existing.expiresAt.getTime() <= now.getTime()) {
    // Expired or removed between the insert and the read. Treat as a fresh
    // attempt: a stale claim must never be able to answer a new save.
    return { status: "in_flight" };
  }

  // A key is per-writer by construction, but the row carries the userId and the
  // check is cheap. A key from another writer must never resolve to their draft.
  if (existing.userId !== userId) {
    log.warn("idempotency key presented by a different writer", { key });
    return { status: "in_flight" };
  }

  if (!existing.postId) return { status: "in_flight" };

  // The claim outlives the document it points at — a draft can be deleted inside
  // the window. Verify the post still exists rather than returning a `postId`
  // that 404s on the client's next request.
  const post = await prisma.post.findUnique({ where: { id: existing.postId }, select: { id: true } });
  if (!post) {
    log.warn("claim references a post that no longer exists", { key });
    return { status: "in_flight" };
  }

  return { status: "existing", postId: post.id };
}

/** Mark a claim complete. Best-effort: a failure here only costs a future retry. */
export async function completeCreate(key: string, postId: string): Promise<void> {
  try {
    await prisma.studioSaveClaim.update({ where: { id: key }, data: { postId } });
  } catch (err) {
    log.warn("could not complete a claim", { key, error: String(err) });
  }
}

/**
 * Release a claim so the same key can be retried.
 *
 * Called when a create failed *before* producing a document. Without it, a
 * transient failure would permanently poison the key and the writer's retry would
 * be refused by a claim belonging to an attempt that never succeeded.
 */
export async function releaseClaim(key: string): Promise<void> {
  try {
    await prisma.studioSaveClaim.deleteMany({ where: { id: key, postId: null } });
  } catch (err) {
    log.warn("could not release a claim", { key, error: String(err) });
  }
}

/**
 * Opportunistic sweeping, at most once an hour per instance.
 *
 * A claim past its window is inert — `claimCreate` treats an expired row as
 * absent — so sweeping is housekeeping rather than correctness. It is triggered
 * here, fire-and-forget, instead of being given its own cron entry for a reason
 * worth stating: a scheduled job would need registry, Inngest and documentation
 * changes, and it would carry a heartbeat that says "this household chore is
 * late" at the same volume as a failing payment reconciliation. The timestamp
 * guard keeps it to one query an hour per instance.
 */
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function sweepInBackground(now: Date): void {
  if (now.getTime() - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now.getTime();
  void sweepClaims().catch((err) => log.warn("claim sweep failed", { error: String(err) }));
}

/** Delete expired claims. Bounded, so a large backlog cannot hold a connection. */
export async function sweepClaims(limit = 5_000): Promise<number> {
  const expired = await prisma.studioSaveClaim.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true },
    take: limit,
  });
  if (expired.length === 0) return 0;

  const deleted = await prisma.studioSaveClaim.deleteMany({
    where: { id: { in: expired.map((row) => row.id) } },
  });
  return deleted.count;
}

/**
 * Read the idempotency key from a request without trusting its shape.
 *
 * Bounded and character-restricted: the key becomes a primary key value, and an
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

/** Prisma's unique-constraint violation, without importing its error classes. */
function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === "P2002";
}
