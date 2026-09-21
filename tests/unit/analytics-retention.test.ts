import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Analytics retention.
 *
 * The dangerous properties here are asymmetric, which shapes the whole file:
 * a prune that does not run is a missed chore, while a prune that runs at the
 * wrong moment **deletes the history the console reports on**. So most of these
 * assertions are about refusing to delete — a window of zero, an unacknowledged
 * rollup, a financial table, an unread notification — rather than about deleting
 * correctly.
 */

const delegates = {
  pageView: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  modelFeedback: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  sportsActivity: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  notification: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  sportsNotificationLog: { count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
};
const executeRaw = vi.fn();
const queryRaw = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pageView: delegates.pageView,
    modelFeedback: delegates.modelFeedback,
    sportsActivity: delegates.sportsActivity,
    notification: delegates.notification,
    sportsNotificationLog: delegates.sportsNotificationLog,
    $executeRaw: (...a: unknown[]) => executeRaw(...a),
    $queryRaw: (...a: unknown[]) => queryRaw(...a),
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}));

const {
  RETENTION_POLICIES,
  resolveRetentionDays,
  pruneAnalytics,
  deleteVisitorHistory,
  rollupDailyMetrics,
  runAnalyticsRetention,
} = await import("@/lib/analytics-retention");

beforeEach(() => {
  vi.clearAllMocks();
  for (const delegate of Object.values(delegates)) {
    delegate.count.mockResolvedValue(0);
    delegate.findMany.mockResolvedValue([]);
    delegate.deleteMany.mockResolvedValue({ count: 0 });
  }
  queryRaw.mockResolvedValue([]);
  executeRaw.mockResolvedValue(1);
});

describe("resolveRetentionDays", () => {
  const prune = RETENTION_POLICIES.find((p) => p.disposition === "prune")!;

  it("falls back to the declared default when the environment says nothing", () => {
    expect(resolveRetentionDays(prune, {})).toBe(prune.retentionDays);
  });

  it("honours an operator override", () => {
    expect(resolveRetentionDays(prune, { [prune.envKey!]: "365" })).toBe(365);
  });

  it("treats zero as 'keep everything', never as 'delete everything older than now'", () => {
    // The single most important assertion in this file. A naive
    // `parseInt(raw) || default` or an unguarded comparison would turn a
    // misconfigured zero into a full-table wipe of exactly the data the job was
    // told to preserve.
    expect(resolveRetentionDays(prune, { [prune.envKey!]: "0" })).toBeNull();
  });

  it("treats a negative value the same way as zero", () => {
    // `-1` would produce a cutoff in the future, which deletes *everything*.
    expect(resolveRetentionDays(prune, { [prune.envKey!]: "-5" })).toBeNull();
  });

  it("falls back to the declared default on unparseable input rather than guessing", () => {
    expect(resolveRetentionDays(prune, { [prune.envKey!]: "ninety" })).toBe(prune.retentionDays);
    expect(resolveRetentionDays(prune, { [prune.envKey!]: "  " })).toBe(prune.retentionDays);
  });

  it("ignores the environment entirely for a retain entry", () => {
    const retain = RETENTION_POLICIES.find((p) => p.disposition === "retain")!;
    expect(resolveRetentionDays(retain, {})).toBeNull();
    expect(resolveRetentionDays(retain, { RETENTION_PAYMENT_DAYS: "30" })).toBeNull();
  });
});

describe("the policy table", () => {
  it("retains every financial and governance record by explicit statement", () => {
    // Not "absent from the list" — present with the reason attached, so the
    // decision is visible to whoever considers changing it.
    for (const table of ["paymentEvent", "moderationLog"]) {
      const policy = RETENTION_POLICIES.find((p) => p.table === table);
      expect(policy, `${table} is not accounted for in the retention policy`).toBeDefined();
      expect(policy?.disposition).toBe("retain");
      expect(policy?.reason.length, `${table}'s retain reason is not explained`).toBeGreaterThan(40);
    }
  });

  it("never leaves a prune entry without a window and an override key", () => {
    for (const policy of RETENTION_POLICIES.filter((p) => p.disposition === "prune")) {
      expect(policy.retentionDays, `${policy.table} has no default window`).toBeGreaterThan(0);
      expect(policy.envKey, `${policy.table} cannot be tuned without a deploy`).toBeTruthy();
      expect(policy.reason.length, `${policy.table} does not say why it is pruned`).toBeGreaterThan(30);
    }
  });

  it("keeps the AI's memory table out of this module's reach", () => {
    // knowledge-retention.ts owns neuralMemory with a decay model; two retention
    // systems on one table would fight, and the fight would look like data loss.
    expect(RETENTION_POLICIES.map((p) => p.table)).not.toContain("neuralMemory");
  });

  it("does not let a first-ever prune hold one connection forever", () => {
    // The batch cap is what makes a large backlog safe, so its presence is a
    // behaviour worth pinning. Asserted through the delegate call shape below.
    expect(RETENTION_POLICIES.filter((p) => p.disposition === "prune").length).toBeGreaterThan(2);
  });
});

describe("pruneAnalytics — refusing to delete", () => {
  it("refuses outright when the rollup has not been acknowledged", async () => {
    // Pruning before aggregating deletes the growth history the product shows.
    // This is the guarantee the module exists for, enforced rather than
    // documented.
    const result = await pruneAnalytics({});
    expect(result.totalDeleted).toBe(0);
    expect(result.outcomes).toEqual([]);
    expect(result.notes.join(" ")).toContain("would delete history");

    // And nothing was even asked of the database.
    expect(delegates.pageView.deleteMany).not.toHaveBeenCalled();
    expect(delegates.pageView.findMany).not.toHaveBeenCalled();
  });

  it("proceeds when aggregation is acknowledged", async () => {
    const result = await pruneAnalytics({ aggregated: true });
    expect(result.totalDeleted).toBe(0); // every delegate returns zero rows
    expect(result.outcomes.length).toBe(RETENTION_POLICIES.length);
  });

  it("counts without deleting on a dry run", async () => {
    delegates.pageView.count.mockResolvedValue(1234);
    const result = await pruneAnalytics({ dryRun: true });

    expect(delegates.pageView.deleteMany).not.toHaveBeenCalled();
    expect(delegates.pageView.findMany).not.toHaveBeenCalled();
    const pageView = result.outcomes.find((o) => o.table === "pageView");
    expect(pageView?.deleted).toBe(1234);
  });

  it("marks a dry run allowed even without the aggregated acknowledgement", async () => {
    // A preview is how an operator decides whether aggregating is safe, so it
    // must not be gated behind the guarantee it exists to verify.
    const result = await pruneAnalytics({ dryRun: true });
    expect(result.notes.join(" ")).not.toContain("would delete history");
  });

  it("deletes only read notifications, never an unread one", async () => {
    // A notification nobody has seen is a pending obligation. Deleting it by age
    // hides it from the reader permanently, which is a worse outcome than a
    // stale row.
    await pruneAnalytics({ aggregated: true });
    const [args] = delegates.notification.findMany.mock.calls[0] as [{ where: { read?: boolean } }];
    expect(args.where.read).toBe(true);
  });

  it("slices the delete so a large backlog cannot be one long transaction", async () => {
    await pruneAnalytics({ aggregated: true });
    const [args] = delegates.pageView.findMany.mock.calls[0] as [{ take: number; orderBy: unknown }];
    expect(args.take).toBeGreaterThan(0);
    expect(args.take).toBeLessThanOrEqual(20_000);
    // Oldest first, so successive runs drain the backlog rather than re-reading
    // the same front of the queue.
    expect(args.orderBy).toEqual({ createdAt: "asc" });
  });

  it("reports a truncated run so the next one is expected", async () => {
    delegates.pageView.findMany.mockResolvedValue(
      Array.from({ length: 20_000 }, (_, i) => ({ id: `p${i}` }))
    );
    delegates.pageView.deleteMany.mockResolvedValue({ count: 20_000 });
    const result = await pruneAnalytics({ aggregated: true });
    const pageView = result.outcomes.find((o) => o.table === "pageView");
    expect(pageView?.truncated).toBe(true);
    expect(result.notes.join(" ")).toContain("cap");
  });

  it("records which tables were retained and why, so the report is not just deletions", async () => {
    const result = await pruneAnalytics({ dryRun: true });
    const retained = result.outcomes.filter((o) => o.disposition === "retain");
    expect(retained.length).toBeGreaterThanOrEqual(2);
    for (const entry of retained) expect(entry.skipped).toBeTruthy();
  });

  it("skips a table whose window was disabled rather than deleting on a zero window", async () => {
    const disabled = RETENTION_POLICIES.find((p) => p.disposition === "prune")!;
    const original = process.env[disabled.envKey!];
    process.env[disabled.envKey!] = "0";
    try {
      const result = await pruneAnalytics({ dryRun: true });
      const entry = result.outcomes.find((o) => o.table === disabled.table);
      expect(entry?.retentionDays).toBeNull();
      expect(entry?.deleted).toBe(0);
      expect(entry?.skipped).toContain("disabled");
    } finally {
      if (original === undefined) delete process.env[disabled.envKey!];
      else process.env[disabled.envKey!] = original;
    }
  });

  it("survives one table failing without abandoning the others", async () => {
    delegates.pageView.findMany.mockRejectedValue(new Error("canceling statement due to statement timeout"));
    const result = await pruneAnalytics({ aggregated: true });

    const failed = result.outcomes.find((o) => o.table === "pageView");
    expect(failed?.skipped).toContain("statement timeout");
    expect(result.notes.join(" ")).toContain("pageView");
    // The remaining tables still processed, so one bad predicate does not stall
    // the whole retention pass.
    expect(delegates.modelFeedback.findMany).toHaveBeenCalled();
  });
});

describe("rollupDailyMetrics", () => {
  it("writes each metric with an idempotent upsert", async () => {
    // A re-run of a partially completed rollup must update rather than
    // double-count; a plain INSERT would either fail on the unique key and
    // abandon the rest of the window, or — worse, if the key were absent —
    // double every chart that reads it.
    queryRaw.mockResolvedValueOnce([{ day: new Date("2026-09-01T00:00:00Z"), n: BigInt(120) }]);
    const rows = await rollupDailyMetrics(1);
    expect(rows).toEqual([{ day: "2026-09-01", metric: "pageviews", dimension: "", value: 120 }]);

    const statement = String((executeRaw.mock.calls[0] as unknown[])[0]);
    expect(statement).toContain("ON CONFLICT");
    expect(statement).toContain("DailyMetric");
  });

  it("writes nothing when there is nothing in the window", async () => {
    const rows = await rollupDailyMetrics(7);
    expect(rows).toEqual([]);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("carries the dimension for a metric that has one", async () => {
    queryRaw
      .mockResolvedValueOnce([]) // pageviews
      .mockResolvedValueOnce([]) // unique visitors
      .mockResolvedValueOnce([{ day: new Date("2026-09-01T00:00:00Z"), type: "click", n: BigInt(7) }])
      .mockResolvedValueOnce([]);
    const rows = await rollupDailyMetrics(1);
    expect(rows).toEqual([{ day: "2026-09-01", metric: "model_feedback", dimension: "click", value: 7 }]);
  });

  it("converts Postgres bigint counts instead of stringifying them", async () => {
    // `COUNT(*)` arrives as BigInt, and `Number(x)` on a BigInt is fine while
    // `JSON.stringify` on one throws — this pins the conversion at the boundary.
    queryRaw.mockResolvedValueOnce([{ day: new Date("2026-09-02T00:00:00Z"), n: BigInt(9) }]);
    const rows = await rollupDailyMetrics(1);
    expect(typeof rows[0]?.value).toBe("number");
  });
});

describe("runAnalyticsRetention — the ordering guarantee", () => {
  it("derives a rollup window that covers the longest prune window", async () => {
    // Rolling up 30 days while pruning 180 would delete 150 days of
    // unaggregated detail — precisely the mistake the module exists to prevent,
    // so the window is derived rather than defaulted.
    const longest = Math.max(
      ...RETENTION_POLICIES.filter((p) => p.disposition === "prune").map((p) => resolveRetentionDays(p) ?? 0)
    );
    const report = await runAnalyticsRetention({});
    expect(report.rollupWindowDays).toBeGreaterThanOrEqual(longest);
    expect(report.rollupWindowDays).toBeGreaterThanOrEqual(30);
  });

  it("writes nothing at all on a dry run", async () => {
    const report = await runAnalyticsRetention({ dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(report.rolledUp).toBe(0);
    expect(report.totalDeleted).toBe(0);
    expect(executeRaw).not.toHaveBeenCalled();
    expect(delegates.pageView.deleteMany).not.toHaveBeenCalled();
    expect(report.notes.join(" ")).toContain("Dry run");
  });

  it("states in its own report that the rollup preceded the prune", async () => {
    queryRaw.mockResolvedValueOnce([{ day: new Date("2026-09-01T00:00:00Z"), n: BigInt(3) }]);
    const report = await runAnalyticsRetention({});
    expect(report.rolledUp).toBe(1);
    expect(report.notes.join(" ")).toContain("before pruning");
  });

  it("applies the same dry-run rule to the prune it delegates to", async () => {
    // Not assumed: if `runAnalyticsRetention` forgot to pass `dryRun` down, the
    // preview would silently delete. Asserted by the absence of any delete call.
    await runAnalyticsRetention({ dryRun: true });
    for (const delegate of Object.values(delegates)) {
      expect(delegate.deleteMany).not.toHaveBeenCalled();
    }
  });
});

describe("deleteVisitorHistory — privacy deletion", () => {
  it("refuses a short or empty value", async () => {
    // A truncated hash would delete the wrong person's rows, or — at the empty
    // string — match every row that has no hash. Both are worse than a refusal.
    await expect(deleteVisitorHistory("")).rejects.toThrow(/short or empty/);
    await expect(deleteVisitorHistory("abc")).rejects.toThrow(/short or empty/);
    expect(delegates.pageView.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes by the visitor hash alone and reports the count", async () => {
    delegates.pageView.deleteMany.mockResolvedValue({ count: 42 });
    const deleted = await deleteVisitorHistory("a1b2c3d4e5f6");
    expect(deleted).toBe(42);
    expect(delegates.pageView.deleteMany).toHaveBeenCalledWith({ where: { visitorHash: "a1b2c3d4e5f6" } });
  });
});
