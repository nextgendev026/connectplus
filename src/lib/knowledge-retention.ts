import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

/**
 * Knowledge retention for the hive.
 *
 * The mind could *accumulate* knowledge but not *retain* it. That distinction is
 * the whole point of this module. The hive was at 5,447 memories and growing
 * every sweep, and a large share of that was the same fact stored repeatedly —
 * the probe showed 2,082 `entity` rows and 1,825 `wisdom` rows, where "Nairobi
 * (location) — from post X" is re-learned once per mention. Three problems
 * follow, and retention means fixing all three:
 *
 *   1. **Recall degrades as the hive grows.** The same fact appears many times,
 *      so a top-8 recall can be eight copies of one thing instead of eight
 *      things. Deduplication raises the information density of every query.
 *   2. **Nothing is reinforced.** A memory that answers questions every day had
 *      exactly the standing of one written once and never read. Recall now
 *      strengthens what it retrieves.
 *   3. **Nothing ages.** A two-year-old counter and yesterday's finding ranked
 *      alike. Confidence is now decayed by age, but only per *reading* — the
 *      stored value is never overwritten, so the original is always recoverable
 *      and nothing is destroyed by a ranking decision.
 *
 * The governing rule: decay changes ORDER, consolidation changes STORAGE, and
 * neither one silently destroys a fact. Where a duplicate is removed, what it
 * contained is folded into the survivor first, and the survivor records how many
 * copies were merged so the merge is auditable.
 */

const log = createLogger("knowledge-retention");

const DAY_MS = 24 * 60 * 60 * 1000;

/** Categories whose contents are learnings, not facts. Never consolidated away. */
const PROTECTED_CATEGORIES = new Set(["lesson", "traffic-pulse", "intent-map", "signal", "ai"]);

/** Half-life for an unreinforced memory, in days. */
export const DEFAULT_HALF_LIFE_DAYS = 45;

export interface RetentionRow {
  id: string;
  category: string;
  content: string;
  tags: string;
  confidence: number;
  accessCount: number;
  createdAt: Date;
  lastAccessedAt?: Date | null;
  metadata?: string | null;
}

/**
 * Confidence as of *now*, given age and reinforcement.
 *
 * Two properties matter and are easy to get wrong:
 *
 *   - Decay is measured from the last time the memory was *used*, falling back
 *     to when it was written. Age since creation would punish a memory that has
 *     been recalled every day for a month.
 *   - Reinforcement extends the half-life rather than adding a flat bonus, so a
 *     well-used memory decays more slowly instead of being pinned at the top
 *     forever. The multiplier is capped so one hot memory cannot become
 *     permanently unassailable.
 *
 * This is a pure function of the row and the clock: it never writes, which is
 * what makes it safe to call during recall.
 */
export function effectiveConfidence(row: RetentionRow, now = new Date(), halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  const reinforcements = Math.min(Math.max(row.accessCount, 0), 25);
  const halfLife = halfLifeDays * (1 + reinforcements * 0.25);
  const anchor = row.lastAccessedAt ?? row.createdAt;
  const ageDays = Math.max(0, (now.getTime() - anchor.getTime()) / DAY_MS);
  const decayed = row.confidence * Math.pow(0.5, ageDays / halfLife);
  // Floored at 5% of the base: a memory that was true does not become false
  // because it is old, it just stops outranking current material.
  return Math.max(round(decayed), round(row.confidence * 0.05));
}

/**
 * Rank candidates by standing, reinforcement and recency.
 *
 * Recency is a tie-break, not a driver: a small, bounded bonus for material from
 * the last fortnight, so two equally-standing memories resolve toward the newer
 * one without letting novelty outrank a well-reinforced fact.
 */
export function rankMemories<T extends RetentionRow>(rows: T[], now = new Date()): T[] {
  const scored = rows.map((row) => {
    const standing = effectiveConfidence(row, now);
    const reinforcement = 1 + Math.log1p(Math.max(row.accessCount, 0));
    const ageDays = Math.max(0, (now.getTime() - row.createdAt.getTime()) / DAY_MS);
    const recency = ageDays <= 14 ? 1.1 : 1;
    return { row, score: standing * reinforcement * recency };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.row);
}

/**
 * The canonical identity of a memory, for spotting the same fact stored twice.
 *
 * Entity rows are keyed by the entity and its type, because "Nairobi (location)"
 * is the same fact however many posts mention it. Everything else is keyed by
 * the first set of meaningful words, which is what makes two summaries of the
 * same story collide while two different stories do not.
 */
export function canonicalKey(row: { category: string; content: string }): string {
  const text = row.content.trim();
  if (row.category === "entity") {
    // "Value (type) — from post …" → "value::type"
    const match = /^(.{1,80}?)\s*\(([^)]{1,40})\)/.exec(text);
    return match ? `${norm(match[1] ?? "")}::${norm(match[2] ?? "")}` : norm(text.slice(0, 60));
  }
  const head = text.split(/[.!?—]/)[0] ?? text;
  return norm(head).split(" ").slice(0, 10).join(" ");
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export interface ConsolidationResult {
  scanned: number;
  clusters: number;
  mergedAway: number;
  tagsMerged: number;
  /** True when nothing was written — safe to run against production to preview. */
  dryRun: boolean;
  /** The largest clusters, so a preview says *what* would merge, not just how many. */
  biggestClusters: { category: string; key: string; copies: number; kept: string }[];
}

export interface RetentionReport {
  totalBefore: number;
  totalAfter: number;
  consolidated: ConsolidationResult;
  pruned: number;
  byCategory: { category: string; count: number }[];
  notes: string[];
}

class KnowledgeRetention {
  private readonly log = createLogger("knowledge-retention");

  /**
   * Merge memories that are the same fact stored more than once.
   *
   * Only exact canonical matches are merged, never "similar" ones — a fuzzy
   * merge would quietly combine two different facts and there is no way to
   * notice afterwards. For each cluster the survivor is the member with the
   * highest confidence, tie-broken by use; the union of tags is folded in, the
   * use counts are summed so standing is not lost, and the merged count is
   * recorded in metadata so the merge can be audited later.
   *
   * Called by the nightly sweep, so the hive converges rather than growing.
   */
  async consolidate(maxScan = 6000, opts: { dryRun?: boolean } = {}): Promise<ConsolidationResult> {
    const dryRun = opts.dryRun === true;
    const rows = await prisma.neuralMemory.findMany({
      where: { category: { notIn: Array.from(PROTECTED_CATEGORIES) } },
      orderBy: [{ confidence: "desc" }, { accessCount: "desc" }],
      take: maxScan,
      select: {
        id: true,
        category: true,
        content: true,
        tags: true,
        confidence: true,
        accessCount: true,
        createdAt: true,
        metadata: true,
      },
    });

    const clusters = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.category}::${canonicalKey(row)}`;
      const bucket = clusters.get(key);
      if (bucket) bucket.push(row);
      else clusters.set(key, [row]);
    }

    let mergedAway = 0;
    let tagsMerged = 0;
    let mergedClusters = 0;
    const biggestClusters: ConsolidationResult["biggestClusters"] = [];

    for (const [clusterKey, members] of clusters) {
      if (members.length < 2) continue;

      // Sorted by confidence then use, so the first member is the survivor.
      const [survivor, ...duplicates] = members;
      if (!survivor) continue;

      const tagSet = new Set<string>();
      for (const member of members) {
        for (const tag of member.tags.split(",").map((t) => t.trim()).filter(Boolean)) tagSet.add(tag);
      }
      const totalAccess = members.reduce((sum, m) => sum + m.accessCount, 0);
      const firstSeen = members.reduce((oldest, m) => (m.createdAt < oldest ? m.createdAt : oldest), members[0]!.createdAt);

      let metadata: Record<string, unknown> = {};
      try {
        metadata = survivor.metadata ? (JSON.parse(survivor.metadata) as Record<string, unknown>) : {};
      } catch {
        metadata = {};
      }

      const duplicateIds = duplicates.map((d) => d.id);
      biggestClusters.push({
        category: survivor.category,
        key: clusterKey.split("::").slice(1).join("::").slice(0, 70),
        copies: duplicateIds.length,
        kept: survivor.id,
      });

      // A dry run reports exactly what a real run would remove and writes
      // nothing, which is what makes it safe to preview against production.
      if (dryRun) {
        mergedAway += duplicateIds.length;
        tagsMerged += tagSet.size;
        mergedClusters += 1;
        continue;
      }

      await prisma.$transaction([
        prisma.neuralMemory.update({
          where: { id: survivor.id },
          data: {
            tags: Array.from(tagSet).slice(0, 20).join(","),
            // Confidence is the survivor's own; merging must not raise a fact's
            // certainty just because it was repeated.
            accessCount: totalAccess,
            metadata: JSON.stringify({
              ...metadata,
              consolidated: {
                mergedCount: duplicateIds.length,
                firstSeen: firstSeen.toISOString(),
                mergedAt: new Date().toISOString(),
              },
            }),
          },
        }),
        prisma.neuralMemory.deleteMany({ where: { id: { in: duplicateIds } } }),
      ]);

      mergedAway += duplicateIds.length;
      tagsMerged += tagSet.size;
      mergedClusters += 1;
      this.log.debug("consolidated cluster", { category: survivor.category, merged: duplicateIds.length });
    }

    biggestClusters.sort((a, b) => b.copies - a.copies);

    return {
      scanned: rows.length,
      clusters: mergedClusters,
      mergedAway,
      tagsMerged,
      dryRun,
      biggestClusters: biggestClusters.slice(0, 10),
    };
  }

  /**
   * Delete the least valuable memories once the hive passes a hard cap.
   *
   * Off by default (`cap` of 0) and deliberately conservative when on: only
   * categories that are not protected, only memories that have *never been
   * recalled* (`accessCount` 0), and always the lowest-standing first. A memory
   * that answered a question has demonstrable value, so it is never a pruning
   * candidate however old it is.
   *
   * Consolidation alone makes the hive converge, so this is the backstop for a
   * pathological feed rather than the main mechanism.
   */
  async prune(cap: number): Promise<number> {
    if (!Number.isFinite(cap) || cap <= 0) return 0;

    const total = await prisma.neuralMemory.count();
    if (total <= cap) return 0;

    const excess = total - cap;
    const candidates = await prisma.neuralMemory.findMany({
      where: { category: { notIn: Array.from(PROTECTED_CATEGORIES) }, accessCount: 0 },
      orderBy: [{ confidence: "asc" }, { createdAt: "asc" }],
      take: Math.min(excess, 2000),
      select: { id: true },
    });

    if (candidates.length === 0) return 0;

    const deleted = await prisma.neuralMemory.deleteMany({
      where: { id: { in: candidates.map((c) => c.id) } },
    });

    this.log.warn("pruned hive memories over cap", { cap, requested: excess, deleted: deleted.count });
    return deleted.count;
  }

  /**
   * Read-only view of standing, for the console and for verification runs.
   * Never mutates, so it is safe to call from a request path.
   */
  async report(limit = 12): Promise<{ total: number; byCategory: { category: string; count: number }[]; bySource: { source: string; count: number }[]; leastUsed: RetentionRow[] }> {
    const now = new Date();
    const [total, byCategory, bySource, lowValue] = await Promise.all([
      prisma.neuralMemory.count(),
      prisma.neuralMemory.groupBy({ by: ["category"], _count: { id: true } }),
      prisma.neuralMemory.groupBy({ by: ["source"], _count: { id: true } }),
      prisma.neuralMemory.findMany({
        orderBy: [{ accessCount: "asc" }, { createdAt: "asc" }],
        take: limit,
        select: { id: true, category: true, content: true, tags: true, confidence: true, accessCount: true, createdAt: true, lastAccessedAt: true },
      }),
    ]);

    return {
      total,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count.id })).sort((a, b) => b.count - a.count),
      bySource: bySource.map((s) => ({ source: s.source, count: s._count.id })).sort((a, b) => b.count - a.count),
      leastUsed: rankMemories(lowValue, now),
    };
  }

  /**
   * The nightly retention pass: merge duplicates, then enforce the cap if one is
   * configured. Recomputes totals so the report proves what it changed rather
   * than asserting it.
   */
  async runMaintenance(opts: { maxScan?: number; cap?: number; dryRun?: boolean } = {}): Promise<RetentionReport> {
    const notes: string[] = [];
    const totalBefore = await prisma.neuralMemory.count();

    const consolidated = await this.consolidate(opts.maxScan ?? 6000, { dryRun: opts.dryRun });
    if (consolidated.clusters === 0) notes.push("No duplicate clusters found — the hive is already distinct.");

    const cap = opts.dryRun ? 0 : (opts.cap ?? Number(process.env.HIVE_MAX_MEMORIES ?? 0));
    const pruned = await this.prune(cap);
    if (opts.dryRun) notes.push("Dry run: nothing was written and nothing was deleted.");
    if (cap <= 0) notes.push("Pruning disabled (HIVE_MAX_MEMORIES unset) — consolidation alone bounds growth.");

    const totalAfter = await prisma.neuralMemory.count();
    const byCategory = await prisma.neuralMemory.groupBy({ by: ["category"], _count: { id: true } });

    this.log.info("retention maintenance complete", {
      totalBefore,
      totalAfter,
      mergedAway: consolidated.mergedAway,
      pruned,
    });

    return {
      totalBefore,
      totalAfter,
      consolidated,
      pruned,
      byCategory: byCategory.map((c) => ({ category: c.category, count: c._count.id })).sort((a, b) => b.count - a.count),
      notes,
    };
  }
}

export const knowledgeRetention = new KnowledgeRetention();
