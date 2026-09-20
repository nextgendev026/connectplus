import { prisma } from "./prisma";
import {
  convexHealth,
  convexMarkViewsSynced,
  convexPendingViewsPage,
  convexPruneViewDays,
} from "./convex";
import { recordHeartbeat } from "./job-heartbeat";
import { createLogger } from "./logger";

const log = createLogger("view-sync");

/**
 * Folding Convex's view deltas back into Postgres.
 *
 * Article renders are written to Convex so Supabase's write budget is spent on
 * the reads that need a relational store; the accumulated deltas are folded
 * into `Post.viewCount` on the nightly sweep, which is what ranking and every
 * card read.
 *
 * Three things this loop has to get right, each of them a bug that was here:
 *
 *   1. **The read must be bounded.** It used to ask Convex for "the first 500",
 *      which Convex answered by reading the entire `postViews` table and
 *      slicing — so the cost grew with the table, and past the per-execution
 *      document limit the query threw. The fold then reported "Convex
 *      unreachable" and blamed the deployment for a read that had outgrown its
 *      ceiling. It now walks bounded pages.
 *
 *   2. **The backlog must actually drain.** One pass of 500 posts a night is a
 *      ceiling on throughput, not a queue: once more than 500 posts had unseen
 *      deltas, the backlog grew every night and "views waiting" climbed forever.
 *      It now walks pages until the walk is done, within a per-run budget.
 *
 *   3. **One orphan must not wedge the whole backlog.** A delta whose post no
 *      longer exists in Postgres — a deleted post, a syndicated story that was
 *      withdrawn, a row left by a diagnostic — could never be written, so it
 *      could never be marked synced, so it sat at the front of the pending set
 *      *forever* and every night's pass re-read it. The count never reached
 *      zero and no amount of running the job fixed it. A delta that Postgres
 *      says is missing is now dropped instead of retried; a transient database
 *      error still leaves it pending, because that one *should* be retried.
 *
 * This used to be two copies of the same loop — one in the cron job, one in the
 * Inngest step — which is exactly how the two can drift. More importantly, the
 * fold had no memory: it could fail every night for a week and the only trace
 * was a step that returned zeros. It now stamps a heartbeat (`view-sync`) with
 * its own outcome, so the admin health view can say *when* the numbers were last
 * reconciled and *what* that pass did.
 */

/** Heartbeat id for the fold. Deliberately not a CRON_JOB: it is a phase of the
 *  nightly sweep, not a schedule of its own, so it must not appear in the
 *  scheduler table. */
export const VIEW_SYNC_HEARTBEAT = "view-sync";

/** Rows per page read from Convex. */
const PAGE_SIZE = 250;
/**
 * Most pages one pass will walk (≤2000 posts). A budget rather than "all of
 * it": the sweep shares a CPU allowance with everything else it does, and a
 * pass that stops early records that it stopped early, so a backlog that
 * outruns the budget is visible rather than silently truncated.
 */
const MAX_PAGES = 8;
/**
 * Batches of `viewDays` deleted per pass, and rows per batch. Ten batches of
 * 200 clears more than a day's worth of inserts at steady state while staying
 * well inside a single Convex transaction's write budget.
 */
const PRUNE_DAY_BATCHES = 10;
const PRUNE_DAY_BATCH = 200;
/** How long per-day buckets are kept. Only "today" is ever read. */
const DAY_RETENTION = 90;

export interface ViewFoldResult {
  /** Posts whose Postgres row accepted a delta. */
  posts: number;
  /** Views folded in this pass. */
  views: number;
  /** Deltas that were waiting when the pass started. */
  waiting: number;
  /** True when Convex could not be reached, so nothing could be read. */
  unreachable: boolean;
  /** Pages walked, and whether the walk reached the end. */
  pages: number;
  drained: boolean;
  /** Deltas abandoned because their post no longer exists. */
  orphaned: number;
  /** Stale daily buckets deleted in this pass. */
  prunedDays: number;
}

/** Prisma's "record to update not found" — a delta for a post that is gone. */
function isMissingRow(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2025"
  );
}

/** A UTC day string `days` before now, for the retention cutoff. */
function dayCutoff(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Delete per-day view buckets past the retention window, in bounded batches.
 *
 * `viewDays` gains a row per post per day and nothing ever removed them. That
 * is unbounded growth in the one Convex resource the free tier meters by
 * *stored bytes*, and its failure mode is writes starting to reject — the same
 * "views quietly stop counting" symptom as the read ceiling, from the opposite
 * direction. Only the current day is ever read (`topToday`), so a window is
 * pure waste.
 */
async function pruneOldViewDays(): Promise<number> {
  const before = dayCutoff(DAY_RETENTION);
  let deleted = 0;
  for (let i = 0; i < PRUNE_DAY_BATCHES; i++) {
    const n = await convexPruneViewDays(before, PRUNE_DAY_BATCH).catch(() => 0);
    deleted += n;
    // A short batch means the backlog is exhausted; stop asking.
    if (n < PRUNE_DAY_BATCH) break;
  }
  return deleted;
}

/**
 * Read the pending deltas, apply them to Postgres, then mark them reconciled in
 * Convex. A pending delta is only marked once Postgres has accepted it (or told
 * us there is no such post), so a crash mid-loop re-applies the remaining work
 * next pass instead of dropping it.
 *
 * Never throws for a Convex outage: the nightly sweep has other work to do, and
 * the outage is recorded rather than escalated.
 */
export async function foldConvexViews(): Promise<ViewFoldResult> {
  let cursor: string | null = null;
  let posts = 0;
  let views = 0;
  let waiting = 0;
  let pages = 0;
  let orphaned = 0;
  let drained = false;
  let unreachable = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await convexPendingViewsPage(cursor, PAGE_SIZE);

    // `convexPendingViewsPage` answers an unreachable deployment with an empty
    // page — indistinguishable from "nothing is waiting". Reporting the outage
    // as an empty backlog is precisely the silent failure this ledger exists to
    // end, so a failing health state always wins over the empty answer.
    if (convexHealth().state === "failing") {
      unreachable = true;
      break;
    }

    pages++;
    waiting += result.views.length;

    const applied: string[] = [];
    for (const delta of result.views) {
      const outcome = await prisma.post
        .update({ where: { id: delta.postId }, data: { viewCount: { increment: delta.delta } } })
        .then(() => "applied" as const)
        .catch((error: unknown) => (isMissingRow(error) ? ("missing" as const) : ("failed" as const)));

      if (outcome === "applied") {
        applied.push(delta.postId);
        views += delta.delta;
      } else if (outcome === "missing") {
        // No such post: this delta can never be applied. Marking it reconciled
        // is what lets the backlog behind it drain; leaving it pending is how
        // an orphaned row kept "views waiting" above zero forever.
        applied.push(delta.postId);
        orphaned++;
      }
      // "failed" is deliberately not marked — a transient database error must
      // be retried next pass rather than silently dropped.
    }

    if (applied.length > 0) {
      posts += await convexMarkViewsSynced(applied);
    }

    cursor = result.continueCursor;
    if (result.isDone) {
      drained = true;
      break;
    }
  }

  if (unreachable) {
    const detail = `Convex unreachable — view deltas could not be folded: ${convexHealth().error ?? "unknown error"}`;
    log.warn("view fold blocked", { error: convexHealth().error ?? "unknown" });
    await recordHeartbeat(VIEW_SYNC_HEARTBEAT, { ok: false, detail });
    return {
      posts,
      views,
      waiting,
      unreachable: true,
      pages,
      drained: false,
      orphaned,
      prunedDays: 0,
    };
  }

  const prunedDays = await pruneOldViewDays();

  const folded = `${posts} post${posts === 1 ? "" : "s"} · ${views} view${views === 1 ? "" : "s"} folded`;
  const tail = [
    orphaned > 0 ? `${orphaned} orphaned delta${orphaned === 1 ? "" : "s"} dropped` : "",
    prunedDays > 0 ? `${prunedDays} stale day bucket${prunedDays === 1 ? "" : "s"} pruned` : "",
  ].filter(Boolean);

  const detail = !drained
    ? `${folded} over ${pages} page${pages === 1 ? "" : "s"} — backlog remains and will continue next pass`
    : waiting === 0
      ? ["nothing waiting", ...tail].join(" · ")
      : [folded, ...tail].join(" · ");

  await recordHeartbeat(VIEW_SYNC_HEARTBEAT, { ok: true, detail });

  return { posts, views, waiting, unreachable: false, pages, drained, orphaned, prunedDays };
}
