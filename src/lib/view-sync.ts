import { prisma } from "./prisma";
import { convexHealth, convexMarkViewsSynced, convexPendingViews } from "./convex";
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

export interface ViewFoldResult {
  /** Posts whose Postgres row accepted a delta. */
  posts: number;
  /** Views folded in this pass. */
  views: number;
  /** Deltas that were waiting when the pass started. */
  waiting: number;
  /** True when Convex could not be reached, so nothing could be read. */
  unreachable: boolean;
}

/**
 * Read the pending deltas, apply them to Postgres, then mark them reconciled in
 * Convex. A pending delta is only marked once Postgres has accepted it, so a
 * crash mid-loop re-applies the remaining work next pass instead of dropping it.
 *
 * Never throws for a Convex outage: the nightly sweep has other work to do, and
 * the outage is recorded rather than escalated.
 */
export async function foldConvexViews(limit = 500): Promise<ViewFoldResult> {
  let deltas: Awaited<ReturnType<typeof convexPendingViews>> = [];
  try {
    deltas = await convexPendingViews(limit);
  } catch (error) {
    log.warn("pending view read failed", { error: String(error) });
  }

  // `convexPendingViews` answers an unreachable deployment with `[]` — which is
  // indistinguishable from "nothing is waiting", and reporting the outage as an
  // empty backlog is precisely the silent failure this ledger exists to end.
  const health = convexHealth();
  if (health.state === "failing") {
    await recordHeartbeat(VIEW_SYNC_HEARTBEAT, {
      ok: false,
      detail: `Convex unreachable — view deltas could not be folded: ${health.error ?? "unknown error"}`,
    });
    return { posts: 0, views: 0, waiting: 0, unreachable: true };
  }

  if (deltas.length === 0) {
    await recordHeartbeat(VIEW_SYNC_HEARTBEAT, { ok: true, detail: "nothing waiting" });
    return { posts: 0, views: 0, waiting: 0, unreachable: false };
  }

  let views = 0;
  const applied: string[] = [];
  for (const delta of deltas) {
    const ok = await prisma.post
      .update({ where: { id: delta.postId }, data: { viewCount: { increment: delta.delta } } })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      applied.push(delta.postId);
      views += delta.delta;
    }
  }

  const posts = await convexMarkViewsSynced(applied);
  await recordHeartbeat(VIEW_SYNC_HEARTBEAT, {
    ok: true,
    detail: `${posts} post${posts === 1 ? "" : "s"} · ${views} view${views === 1 ? "" : "s"} folded`,
  });

  return { posts, views, waiting: deltas.length, unreachable: false };
}
