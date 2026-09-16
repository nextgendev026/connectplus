import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Prisma mocked shut.
 *
 * Consolidation DELETES rows, so the thing worth pinning is not "did it run"
 * but exactly which row survives, what is folded into it, and that a dry run
 * writes nothing at all. Those assertions need a stub that records the calls;
 * letting them hit a real database would mean running a destructive merge to
 * find out whether a destructive merge is correct.
 */
const findMany = vi.fn();
const update = vi.fn();
const deleteMany = vi.fn();
const count = vi.fn();
const groupBy = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    neuralMemory: {
      findMany: (...a: unknown[]) => findMany(...a),
      update: (...a: unknown[]) => update(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
      count: (...a: unknown[]) => count(...a),
      groupBy: (...a: unknown[]) => groupBy(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}));

const { knowledgeRetention, effectiveConfidence, rankMemories, canonicalKey, DEFAULT_HALF_LIFE_DAYS } = await import(
  "@/lib/knowledge-retention"
);

const DAY = 24 * 60 * 60 * 1000;

function row(overrides: Partial<Parameters<typeof effectiveConfidence>[0]> & { id: string }) {
  return {
    category: "entity",
    content: "Nairobi (location) — from post A",
    tags: "location,nairobi",
    confidence: 0.7,
    accessCount: 0,
    createdAt: new Date(),
    lastAccessedAt: null,
    metadata: null,
    ...overrides,
  };
}

beforeEach(() => {
  findMany.mockReset();
  update.mockReset();
  deleteMany.mockReset();
  count.mockReset();
  groupBy.mockReset();
  transaction.mockReset();
  update.mockResolvedValue({});
  deleteMany.mockResolvedValue({ count: 0 });
  transaction.mockImplementation(async (ops: unknown[]) => ops);
});

describe("effectiveConfidence", () => {
  const now = new Date("2026-09-16T00:00:00Z");

  it("returns the stored confidence for a fresh, unused memory", () => {
    const value = effectiveConfidence(row({ id: "a", createdAt: now }), now);
    expect(value).toBeCloseTo(0.7, 2);
  });

  it("halves an unused memory after one half-life", () => {
    const old = row({ id: "a", createdAt: new Date(now.getTime() - DEFAULT_HALF_LIFE_DAYS * DAY) });
    expect(effectiveConfidence(old, now)).toBeCloseTo(0.35, 2);
  });

  it("decays from the last read, not from creation", () => {
    // Written long ago but read today: age must not be held against it.
    const recentlyRead = row({
      id: "a",
      createdAt: new Date(now.getTime() - 400 * DAY),
      lastAccessedAt: new Date(now.getTime() - 60_000),
    });
    expect(effectiveConfidence(recentlyRead, now)).toBeCloseTo(0.7, 2);
  });

  it("slows decay when a memory has been reinforced", () => {
    const created = new Date(now.getTime() - DEFAULT_HALF_LIFE_DAYS * DAY);
    const unused = effectiveConfidence(row({ id: "a", createdAt: created }), now);
    const used = effectiveConfidence(row({ id: "b", createdAt: created, accessCount: 8 }), now);
    expect(used).toBeGreaterThan(unused);
  });

  it("never decays away entirely — the floor is 5% of the stored value", () => {
    const ancient = row({ id: "a", createdAt: new Date(now.getTime() - 3650 * DAY) });
    expect(effectiveConfidence(ancient, now)).toBeCloseTo(0.035, 3);
  });

  it("does not mutate the row it is given", () => {
    const original = row({ id: "a", createdAt: new Date(now.getTime() - 400 * DAY) });
    const before = original.confidence;
    effectiveConfidence(original, now);
    expect(original.confidence).toBe(before);
  });
});

describe("rankMemories", () => {
  const now = new Date("2026-09-16T00:00:00Z");

  it("puts a reinforced memory above an unreinforced one of equal age", () => {
    const ranked = rankMemories(
      [
        row({ id: "cold", accessCount: 0 }),
        row({ id: "warm", accessCount: 6 }),
      ],
      now
    );
    expect(ranked[0]?.id).toBe("warm");
  });

  it("lets fresh material outrank stale material of the same weight", () => {
    const ranked = rankMemories(
      [
        row({ id: "stale", createdAt: new Date(now.getTime() - 300 * DAY) }),
        row({ id: "fresh", createdAt: new Date(now.getTime() - 2 * DAY) }),
      ],
      now
    );
    expect(ranked[0]?.id).toBe("fresh");
  });

  it("still ranks a heavily reinforced old memory above a brand-new thin one", () => {
    const ranked = rankMemories(
      [
        row({ id: "bedrock", createdAt: new Date(now.getTime() - 200 * DAY), accessCount: 20, confidence: 0.95 }),
        row({ id: "noise", createdAt: new Date(now.getTime() - 1 * DAY), confidence: 0.5 }),
      ],
      now
    );
    expect(ranked[0]?.id).toBe("bedrock");
  });
});

describe("canonicalKey", () => {
  it("keys entities by value and type, so repeat mentions collide", () => {
    const a = canonicalKey({ category: "entity", content: "Nairobi (location) — from post \"Budget 2026\"" });
    const b = canonicalKey({ category: "entity", content: "Nairobi (location) — learned from https://example.com" });
    expect(a).toBe(b);
  });

  it("separates different entities", () => {
    const nairobi = canonicalKey({ category: "entity", content: "Nairobi (location) — from post X" });
    const kampala = canonicalKey({ category: "entity", content: "Kampala (location) — from post X" });
    expect(nairobi).not.toBe(kampala);
  });

  it("separates the same name under a different type", () => {
    const city = canonicalKey({ category: "entity", content: "Safaricom (location)" });
    const org = canonicalKey({ category: "entity", content: "Safaricom (organization)" });
    expect(city).not.toBe(org);
  });

  it("keys topics by the head of the summary", () => {
    const a = canonicalKey({ category: "topic", content: "M-Pesa rates rise across East Africa — summary. Sentiment: positive (0.40)." });
    const b = canonicalKey({ category: "topic", content: "M-Pesa rates rise across East Africa — a different summary entirely." });
    expect(a).toBe(b);
  });
});

describe("consolidate", () => {
  it("keeps the highest-confidence copy and folds in tags, uses and earlier date", async () => {
    const winner = row({
      id: "keep",
      confidence: 0.9,
      accessCount: 2,
      tags: "location",
      content: "Nairobi (location) — from post A",
      createdAt: new Date("2026-01-01T00:00:00Z"),
      metadata: JSON.stringify({ type: "entity" }),
    });
    const losera = row({ id: "dup1", confidence: 0.6, accessCount: 3, tags: "nairobi", content: "Nairobi (location) — from post B" });
    const loserb = row({ id: "dup2", confidence: 0.5, accessCount: 1, tags: "kenya", content: "Nairobi (location) — from post C" });
    findMany.mockResolvedValue([winner, losera, loserb]);

    const result = await knowledgeRetention.consolidate(100);

    expect(result.clusters).toBe(1);
    expect(result.mergedAway).toBe(2);
    expect(result.dryRun).toBe(false);

    const updateArgs = update.mock.calls[0]?.[0] as { where: { id: string }; data: Record<string, unknown> };
    expect(updateArgs.where.id).toBe("keep");

    // Union of tags, not the winner's own list.
    const tags = String(updateArgs.data.tags).split(",").sort();
    expect(tags).toEqual(["kenya", "location", "nairobi"]);

    // Standing is the sum of uses, but confidence stays the winner's — repetition
    // must not make a fact more certain.
    expect(updateArgs.data.accessCount).toBe(6);
    expect(updateArgs.data).not.toHaveProperty("confidence");

    const metadata = JSON.parse(String(updateArgs.data.metadata));
    expect(metadata.consolidated.mergedCount).toBe(2);
    expect(metadata.type).toBe("entity");

    const deleteArgs = deleteMany.mock.calls[0]?.[0] as { where: { id: { in: string[] } } };
    expect(deleteArgs.where.id.in.sort()).toEqual(["dup1", "dup2"]);
  });

  it("writes nothing at all on a dry run", async () => {
    findMany.mockResolvedValue([
      row({ id: "a", content: "Nairobi (location) — from post A" }),
      row({ id: "b", content: "Nairobi (location) — from post B" }),
    ]);

    const result = await knowledgeRetention.consolidate(100, { dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.mergedAway).toBe(1);
    expect(result.biggestClusters[0]?.copies).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("leaves distinct memories alone", async () => {
    findMany.mockResolvedValue([
      row({ id: "a", content: "Nairobi (location) — from post A" }),
      row({ id: "b", content: "Mombasa (location) — from post B" }),
    ]);

    const result = await knowledgeRetention.consolidate(100);

    expect(result.clusters).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("never touches a protected category", async () => {
    findMany.mockResolvedValue([]);
    await knowledgeRetention.consolidate(100);
    const args = findMany.mock.calls[0]?.[0] as { where: { category: { notIn: string[] } } };
    expect(args.where.category.notIn).toContain("lesson");
    expect(args.where.category.notIn).toContain("traffic-pulse");
    expect(args.where.category.notIn).toContain("signal");
  });
});

describe("prune", () => {
  it("does nothing when no cap is configured", async () => {
    expect(await knowledgeRetention.prune(0)).toBe(0);
    expect(count).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing while under the cap", async () => {
    count.mockResolvedValue(100);
    expect(await knowledgeRetention.prune(5000)).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it("only ever offers never-recalled memories as candidates", async () => {
    count.mockResolvedValue(200);
    findMany.mockResolvedValue([]);
    await knowledgeRetention.prune(100);

    const args = findMany.mock.calls[0]?.[0] as { where: { accessCount: number } };
    expect(args.where.accessCount).toBe(0);
  });

  it("deletes exactly the candidates it selected", async () => {
    count.mockResolvedValue(200);
    findMany.mockResolvedValue([{ id: "dead1" }, { id: "dead2" }]);
    deleteMany.mockResolvedValue({ count: 2 });

    expect(await knowledgeRetention.prune(198)).toBe(2);
    const args = deleteMany.mock.calls[0]?.[0] as { where: { id: { in: string[] } } };
    expect(args.where.id.in).toEqual(["dead1", "dead2"]);
  });
});

describe("runMaintenance", () => {
  it("reports the totals it actually moved, and notes a dry run", async () => {
    count.mockResolvedValueOnce(500).mockResolvedValueOnce(498);
    findMany.mockResolvedValue([
      row({ id: "a", content: "Nairobi (location) — from post A" }),
      row({ id: "b", content: "Nairobi (location) — from post B" }),
      row({ id: "c", content: "Nairobi (location) — from post C" }),
    ]);
    groupBy.mockResolvedValue([{ category: "entity", _count: { id: 498 } }]);

    const report = await knowledgeRetention.runMaintenance({ dryRun: true });

    expect(report.totalBefore).toBe(500);
    expect(report.totalAfter).toBe(498);
    expect(report.consolidated.mergedAway).toBe(2);
    expect(report.notes.join(" ")).toContain("Dry run");
  });
});
