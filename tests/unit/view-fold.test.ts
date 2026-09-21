import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The nightly Convex → Postgres view fold.
 *
 * Three failure modes are pinned here, and all three were real:
 *
 *   1. **Unbounded read.** The fold asked Convex for "the first 500", which
 *      Convex answered by reading the whole `postViews` table and slicing. The
 *      cost grew with the table, and past Convex's per-execution document limit
 *      the call *threw* — so a backlog reported itself as a dead deployment.
 *      The walk must therefore page, and must end on `isDone` rather than on a
 *      page that happened to contain no pending rows.
 *
 *   2. **A backlog that cannot drain.** One pass of 500 posts a night is a
 *      throughput ceiling, not a queue. It has to keep walking.
 *
 *   3. **An orphan that wedges everything.** A delta whose post no longer
 *      exists could never be written, so it could never be marked synced, so it
 *      sat at the front of the pending set forever: "views waiting" never
 *      reached zero and no amount of running the job changed that. Such a delta
 *      must be dropped — while a *transient* database error must not be.
 */

const postUpdate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { post: { update: (...a: unknown[]) => postUpdate(...a) } },
}));

const page = vi.fn();
const markSynced = vi.fn();
const health = vi.fn();
const prune = vi.fn();

vi.mock("@/lib/convex", () => ({
  convexPendingViewsPage: (...a: unknown[]) => page(...a),
  convexMarkViewsSynced: (...a: unknown[]) => markSynced(...a),
  convexPruneViewDays: (...a: unknown[]) => prune(...a),
  convexHealth: () => health(),
}));

const heartbeat = vi.fn();
vi.mock("@/lib/job-heartbeat", () => ({
  recordHeartbeat: (...a: unknown[]) => heartbeat(...a),
}));

const { foldConvexViews } = await import("@/lib/view-sync");

/** One page as the Convex function answers it. */
function viewPage(
  views: { postId: string; delta: number; total: number }[],
  { isDone = true, cursor = "c1", scanned = views.length } = {}
) {
  return { views, continueCursor: cursor, isDone, scanned };
}

/** Prisma's "record to update not found". */
const missingRow = () => Object.assign(new Error("not found"), { code: "P2025" });
const transient = () => new Error("connection pool timeout");

beforeEach(() => {
  vi.clearAllMocks();
  health.mockReturnValue({ state: "ok", error: null });
  postUpdate.mockResolvedValue({ id: "x" });
  markSynced.mockImplementation(async (entries: unknown[]) => entries.length);
  prune.mockResolvedValue(0);
});

describe("draining the pending backlog", () => {
  it("applies every delta and marks the accepted posts reconciled", async () => {
    page.mockResolvedValueOnce(
      viewPage([
        { postId: "p1", delta: 4, total: 10 },
        { postId: "p2", delta: 1, total: 1 },
      ])
    );

    const result = await foldConvexViews();

    expect(result.posts).toBe(2);
    expect(result.views).toBe(5);
    expect(result.drained).toBe(true);
    expect(result.unreachable).toBe(false);
    // Each folded amount travels with its post, so Convex advances its counter
    // by exactly what Postgres accepted rather than by whatever the total has
    // drifted to — a view that lands mid-fold stays pending instead of being
    // marked reconciled without ever being counted.
    expect(markSynced).toHaveBeenCalledWith([
      { postId: "p1", delta: 4 },
      { postId: "p2", delta: 1 },
    ]);
    expect(postUpdate).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { viewCount: { increment: 4 } },
    });
  });

  it("keeps walking while more pages remain, even when a page holds nothing", async () => {
    // A page can be empty without being last: the filter is on the values of
    // the rows on that page, not on their position. Ending the walk on an empty
    // page would silently strand the rest of the backlog.
    page
      .mockResolvedValueOnce(viewPage([], { isDone: false, cursor: "c1", scanned: 250 }))
      .mockResolvedValueOnce(viewPage([{ postId: "p9", delta: 3, total: 3 }], { isDone: true, cursor: "c2" }));

    const result = await foldConvexViews();

    expect(page).toHaveBeenCalledTimes(2);
    expect(result.pages).toBe(2);
    expect(result.views).toBe(3);
    expect(result.drained).toBe(true);
  });

  it("passes the previous page's cursor back to Convex", async () => {
    page
      .mockResolvedValueOnce(viewPage([], { isDone: false, cursor: "cursor-a", scanned: 250 }))
      .mockResolvedValueOnce(viewPage([], { isDone: true, cursor: "cursor-b", scanned: 10 }));

    await foldConvexViews();

    expect(page.mock.calls[0]![0]).toBe(null);
    expect(page.mock.calls[1]![0]).toBe("cursor-a");
  });

  it("reports a backlog it could not finish rather than pretending it drained", async () => {
    // Every page says there is more, so the per-run page budget runs out.
    page.mockResolvedValue(viewPage([{ postId: "p1", delta: 1, total: 1 }], { isDone: false }));

    const result = await foldConvexViews();

    expect(result.drained).toBe(false);
    expect(result.pages).toBeGreaterThan(1);
    const detail = heartbeat.mock.calls.at(-1)![1] as { ok: boolean; detail: string };
    expect(detail.ok).toBe(true);
    expect(detail.detail).toMatch(/backlog remains/);
  });
});

describe("a delta that can never be applied", () => {
  it("drops it instead of retrying it forever, so the backlog behind it drains", async () => {
    postUpdate.mockRejectedValueOnce(missingRow()).mockResolvedValueOnce({ id: "p2" });
    page.mockResolvedValueOnce(
      viewPage([
        { postId: "ghost", delta: 1, total: 1 },
        { postId: "p2", delta: 2, total: 2 },
      ])
    );

    const result = await foldConvexViews();

    expect(result.orphaned).toBe(1);
    // Both are marked: the orphan so it stops blocking, the real one because it
    // was actually written.
    expect(markSynced).toHaveBeenCalledWith([
      { postId: "ghost", delta: 1 },
      { postId: "p2", delta: 2 },
    ]);
    // An orphan's views were never folded, so it must not inflate the total.
    expect(result.views).toBe(2);
    expect(result.posts).toBe(2);
    const detail = heartbeat.mock.calls.at(-1)![1] as { detail: string };
    expect(detail.detail).toMatch(/1 orphaned delta dropped/);
  });

  it("folds a sharded counter once per row but reports the post once", async () => {
    // Sharding spreads a post's total over several counter rows, so the fold can
    // legitimately see the same post more than once in a pass. Both deltas must
    // be applied and marked, and the post must still be counted as one.
    page.mockResolvedValueOnce(
      viewPage([
        { postId: "hot", delta: 3, total: 3 },
        { postId: "hot", delta: 5, total: 8 },
      ])
    );

    const result = await foldConvexViews();

    expect(result.views).toBe(8);
    expect(result.posts).toBe(1);
    expect(markSynced).toHaveBeenCalledWith([
      { postId: "hot", delta: 3 },
      { postId: "hot", delta: 5 },
    ]);
  });

  it("leaves a transient database failure pending for the next pass", async () => {
    postUpdate.mockRejectedValueOnce(transient());
    page.mockResolvedValueOnce(viewPage([{ postId: "p1", delta: 1, total: 1 }]));

    const result = await foldConvexViews();

    // Not marked, so tomorrow's walk finds it again — a pool timeout is not
    // permission to abandon somebody's view count.
    expect(markSynced).not.toHaveBeenCalled();
    expect(result.orphaned).toBe(0);
    expect(result.posts).toBe(0);
    expect(result.views).toBe(0);
  });
});

describe("an unreachable deployment", () => {
  it("records a failure heartbeat instead of reporting an empty backlog", async () => {
    health.mockReturnValue({ state: "failing", error: "fetch failed" });
    page.mockResolvedValueOnce(viewPage([], { isDone: true }));

    const result = await foldConvexViews();

    expect(result.unreachable).toBe(true);
    expect(result.prunedDays).toBe(0);
    // Retention must not be attempted against a deployment we cannot reach.
    expect(prune).not.toHaveBeenCalled();
    const [id, payload] = heartbeat.mock.calls.at(-1)! as [string, { ok: boolean; detail: string }];
    expect(id).toBe("view-sync");
    expect(payload.ok).toBe(false);
    expect(payload.detail).toMatch(/unreachable/i);
  });
});

describe("day-bucket retention", () => {
  it("prunes stale buckets and says how many", async () => {
    page.mockResolvedValueOnce(viewPage([], { isDone: true }));
    prune.mockResolvedValueOnce(200).mockResolvedValueOnce(50);

    const result = await foldConvexViews();

    expect(result.prunedDays).toBe(250);
    expect(prune).toHaveBeenCalledTimes(2);
    // A short batch means the store is exhausted; asking again is waste.
    expect(prune.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("stops asking after a full batch that returns nothing", async () => {
    page.mockResolvedValueOnce(viewPage([], { isDone: true }));
    prune.mockResolvedValue(0);

    await foldConvexViews();

    expect(prune).toHaveBeenCalledTimes(1);
    expect(heartbeat.mock.calls.at(-1)![1]).toMatchObject({ ok: true, detail: "nothing waiting" });
  });
});
