import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the RSS "feed starvation" bug.
 *
 * Two properties made ~25 feeds look permanently stuck on 50 fetched items:
 *
 *   1. `lastPolled ASC` sorts NULLs LAST in Postgres, so a brand-new feed queued
 *      behind every already-polled feed and could wait a long time for a first
 *      fetch.
 *   2. A per-run cap of 10 meant only the oldest ten feeds were polled each
 *      cycle, so the tail of the registry never advanced.
 *
 * These tests pin the ordering clause, the due-window maths and the batching
 * contract so neither can silently regress.
 */

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { rssFeed: { findMany } },
}));

vi.mock("@/lib/settings", () => ({
  getSettings: async () => ({ enableRssIngestion: "true" }),
}));

import {
  listDueFeeds,
  selectPollBatch,
  MAX_FEEDS_PER_POLL_RUN,
  type DueFeed,
} from "../../src/lib/rss-poll";

function feed(
  overrides: Partial<DueFeed> & { lastPolled?: Date | null; pollInterval?: number } = {}
) {
  return {
    id: overrides.id ?? "feed-1",
    name: overrides.name ?? "Feed",
    url: overrides.url ?? "https://example.com/rss",
    category: overrides.category ?? "News",
    pollInterval: overrides.pollInterval ?? 3600,
    lastPolled: overrides.lastPolled ?? null,
    httpEtag: null,
    httpLastModified: null,
    consecutiveFailures: 0,
  };
}

beforeEach(() => {
  findMany.mockReset();
});

describe("listDueFeeds ordering", () => {
  it("puts never-polled feeds first with an explicit NULLS FIRST ordering", async () => {
    findMany.mockResolvedValue([]);
    await listDueFeeds();

    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0]![0] as { orderBy: unknown };
    expect(args.orderBy).toEqual([
      { lastPolled: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ]);
  });

  it("includes a never-polled feed even though a polled feed is 'newer'", async () => {
    findMany.mockResolvedValue([
      feed({ id: "new", lastPolled: null }),
      feed({ id: "old", lastPolled: new Date(Date.now() - 4 * 3_600_000) }),
    ]);

    const due = await listDueFeeds();
    expect(due.map((f) => f.id)).toEqual(["new", "old"]);
  });

  it("skips feeds whose poll interval has not elapsed", async () => {
    findMany.mockResolvedValue([
      feed({ id: "fresh", lastPolled: new Date(Date.now() - 60_000), pollInterval: 3600 }),
      feed({ id: "stale", lastPolled: new Date(Date.now() - 2 * 3_600_000), pollInterval: 3600 }),
    ]);

    const due = await listDueFeeds();
    expect(due.map((f) => f.id)).toEqual(["stale"]);
  });

  it("treats the exact interval boundary as due", async () => {
    findMany.mockResolvedValue([
      feed({ id: "boundary", lastPolled: new Date(Date.now() - 3_600_000 - 1000), pollInterval: 3600 }),
    ]);
    const due = await listDueFeeds();
    expect(due).toHaveLength(1);
  });

  it("scopes a forced single-feed poll to that feed id", async () => {
    findMany.mockResolvedValue([feed({ id: "forced", lastPolled: null })]);
    const due = await listDueFeeds("forced");
    expect(due).toHaveLength(1);
    expect(due[0]!.id).toBe("forced");
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { isActive: true, id: "forced" } });
  });
});

describe("selectPollBatch batching", () => {
  it("caps an unattended run and reports the un-reached remainder", () => {
    const due = Array.from({ length: 30 }, (_, i) => feed({ id: `f${i}` }));
    const batch = selectPollBatch(due, { maxFeeds: 10 });

    expect(batch.dueTotal).toBe(30);
    expect(batch.queue).toHaveLength(10);
    expect(batch.queue[0]!.id).toBe("f0");
    expect(batch.dueRemaining).toBe(20);
    expect(batch.cap).toBe(10);
  });

  it("preserves the NULLS-FIRST order in the queue", () => {
    const due = [
      feed({ id: "new-1", lastPolled: null }),
      feed({ id: "new-2", lastPolled: null }),
      feed({ id: "old-1", lastPolled: new Date(Date.now() - 5 * 3_600_000) }),
    ];
    const batch = selectPollBatch(due, { maxFeeds: 2 });
    expect(batch.queue.map((f) => f.id)).toEqual(["new-1", "new-2"]);
    expect(batch.dueRemaining).toBe(1);
  });

  it("never trims a forced single-feed poll, even past the cap", () => {
    const due = Array.from({ length: 100 }, (_, i) => feed({ id: `f${i}` }));
    const batch = selectPollBatch(due, { feedId: "f99", maxFeeds: 1 });
    expect(batch.queue).toHaveLength(100);
    expect(batch.dueRemaining).toBe(0);
  });

  it("clamps a caller's cap to the 100-feed safety ceiling", () => {
    const due = Array.from({ length: 250 }, (_, i) => feed({ id: `f${i}` }));
    const batch = selectPollBatch(due, { maxFeeds: 500 });
    expect(batch.cap).toBe(100);
    expect(batch.queue).toHaveLength(100);
  });

  it("returns an empty queue and zero remainder when nothing is due", () => {
    const batch = selectPollBatch([], {});
    expect(batch.dueTotal).toBe(0);
    expect(batch.queue).toEqual([]);
    expect(batch.dueRemaining).toBe(0);
  });

  it("keeps the unattended default high enough to clear a normal registry", () => {
    // The old default of 10 starved a ~25-feed registry; anything below 20
    // reintroduces the bug for a typical setup.
    expect(MAX_FEEDS_PER_POLL_RUN).toBeGreaterThanOrEqual(20);
    expect(MAX_FEEDS_PER_POLL_RUN).toBeLessThanOrEqual(100);
  });
});
