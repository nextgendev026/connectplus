/**
 * Analytics retention: roll up, then prune.
 *
 * The platform collected high-volume event data and never deleted any of it.
 * `PageView` alone takes an insert for every page render, and the tables around
 * it (`ModelFeedback`, `SportsActivity`, the two notification logs) follow the
 * same shape. Left alone, the cost of the platform's *own* growth is unbounded:
 * every query against those tables gets slower, every backup gets larger, and
 * the indexes get deeper — while the actual information value of a page view
 * from fourteen months ago is nil.
 *
 * The reason this is one module and not a cron entry calling `deleteMany` is
 * the ordering. The console's growth charts read `PageView`. Pruning it without
 * first writing a daily rollup does not "clean up old data", it **deletes the
 * history the product displays** — and nobody notices until someone goes
 * looking for last year's numbers. So:
 *
 *   1. **Aggregate.** `rollupDailyMetrics()` writes per-day counts into
 *      `DailyMetric` for the window about to expire. The unique key on
 *      `(metric, dimension, day)` makes it idempotent: a re-run updates rather
 *      than double-counts, which matters because a job that fails halfway will
 *      be re-run.
 *   2. **Prune.** `pruneAnalytics()` deletes only rows older than the window
 *      that was just aggregated, and only the tables on the policy list.
 *
 * Three things are deliberately NOT on the policy list, and the reason is worth
 * more than the code:
 *
 *   - **`PaymentEvent` and the money tables.** These are financial and audit
 *     records. "Retention" for a payment log means an obligation, not a
 *     cost-saving, and a job that quietly deleted them would be destroying
 *     evidence. They are marked `retain` in the policy table with that reason
 *     attached, so the decision is visible rather than merely absent.
 *   - **`NeuralMemory`.** It has its own retention module
 *     (`knowledge-retention.ts`) built around consolidation and decay, because
 *     a memory's value cannot be reduced to its age. Two retention systems
 *     touching one table would fight.
 *   - **`ModerationLog`.** A moderation decision is a record of who did what to
 *     whose content. That is a governance artifact with the same character as
 *     the payment log.
 *
 * Every prune is opt-in: a table with no `retentionDays` resolved (env unset
 * and no default) is skipped, and `dryRun` counts without deleting.
 */

import { prisma } from "@/lib/prisma";
import { withinBudget } from "@/lib/query-budget";
import { createLogger } from "@/lib/logger";

const log = createLogger("analytics-retention");
const DAY_MS = 24 * 60 * 60 * 1000;

export type RetentionDisposition = "prune" | "retain";

export interface RetentionPolicy {
  /** Prisma delegate name, or the table name for a `retain` entry. */
  table: string;
  disposition: RetentionDisposition;
  /** Days of history kept. Absent on `retain` entries. */
  retentionDays?: number;
  /** Environment override, so an operator can shorten or extend without a deploy. */
  envKey?: string;
  /** Why this table is on the list — read by a human deciding to change it. */
  reason: string;
}

/**
 * The policy table. Deliberately declarative: an operator asking "what does this
 * job delete, and why" gets one answer instead of reading a function body.
 */
export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    table: "pageView",
    disposition: "prune",
    retentionDays: 90,
    envKey: "RETENTION_PAGEVIEW_DAYS",
    reason:
      "Highest-volume table on the platform — one row per render. Rolled up to DailyMetric before deletion, so no reported figure is lost.",
  },
  {
    table: "modelFeedback",
    disposition: "prune",
    retentionDays: 180,
    envKey: "RETENTION_MODEL_FEEDBACK_DAYS",
    reason:
      "Recommendation training signal. Long enough to cover a seasonal cycle, after which it is rolled up and its per-event detail has no consumers.",
  },
  {
    table: "sportsActivity",
    disposition: "prune",
    retentionDays: 180,
    envKey: "RETENTION_SPORTS_ACTIVITY_DAYS",
    reason: "Engagement counters for matches and referrals. Aggregate value only after a season ends.",
  },
  {
    table: "notification",
    disposition: "prune",
    retentionDays: 120,
    envKey: "RETENTION_NOTIFICATION_DAYS",
    reason: "A read notification older than a quarter has no reader. Unread rows are never pruned by this job.",
  },
  {
    table: "sportsNotificationLog",
    disposition: "prune",
    retentionDays: 120,
    envKey: "RETENTION_SPORTS_NOTIFICATION_DAYS",
    reason: "Delivery ledger for favourite alerts. Kept long enough to investigate a delivery complaint, not forever.",
  },
  {
    table: "paymentEvent",
    disposition: "retain",
    reason:
      "Financial and audit record. Retained indefinitely by policy — deleting a payment event destroys reconciliation evidence and the idempotency ledger a retried webhook depends on.",
  },
  {
    table: "moderationLog",
    disposition: "retain",
    reason: "Governance record of who moderated whose content. Same character as the payment ledger.",
  },
] as const;

export interface PruneOutcome {
  table: string;
  disposition: RetentionDisposition;
  retentionDays: number | null;
  cutoff: string | null;
  deleted: number;
  /** True when the row cap for this run was reached, so more remain. */
  truncated: boolean;
  skipped?: string;
}

export interface RollupOutcome {
  day: string;
  metric: string;
  dimension: string;
  value: number;
}

export interface AnalyticsRetentionReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  rolledUp: number;
  rollupWindowDays: number;
  pruned: PruneOutcome[];
  totalDeleted: number;
  notes: string[];
}

/**
 * Resolve the retention window for a policy.
 *
 * An env value of `0` means "keep everything" and is honoured as a skip rather
 * than as "delete everything older than now", which is what a naive
 * `parseInt`-and-compare would produce. That distinction is the difference
 * between a misconfigured variable disabling a job and a misconfigured variable
 * emptying a table.
 */
export function resolveRetentionDays(
  policy: RetentionPolicy,
  env: Record<string, string | undefined> = process.env
): number | null {
  if (policy.disposition !== "prune") return null;
  const raw = policy.envKey ? env[policy.envKey] : undefined;
  if (raw === undefined || raw.trim() === "") return policy.retentionDays ?? null;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) return policy.retentionDays ?? null;
  if (parsed <= 0) return null;
  return parsed;
}

/** Cap per run so a first-ever prune of a large table cannot hold a connection for minutes. */
const DELETE_BATCH_LIMIT = 20_000;

/**
 * The per-day counts written before pruning.
 *
 * Only metrics that something actually reads are computed. A rollup of
 * everything is a second copy of the database, and the point is to *replace*
 * detail with a number nobody has to query per-event.
 */
export async function rollupDailyMetrics(days = 30): Promise<RollupOutcome[]> {
  const span = Math.min(Math.max(Math.floor(days), 1), 400);
  const until = new Date();
  const since = new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate()) - span * DAY_MS);
  const key = (d: Date) => d.toISOString().slice(0, 10);

  const [views, visitors, feedback, sports] = await Promise.all([
    withinBudget("retention.rollupViews", "sweep", () =>
      prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS n
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY day
      `
    ),
    withinBudget("retention.rollupVisitors", "sweep", () =>
      prisma.$queryRaw<{ day: Date; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, COUNT(DISTINCT "visitorHash")::bigint AS n
        FROM "PageView"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until} AND "visitorHash" IS NOT NULL
        GROUP BY day
      `
    ),
    withinBudget("retention.rollupFeedback", "sweep", () =>
      prisma.$queryRaw<{ day: Date; type: string; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, "type", COUNT(*)::bigint AS n
        FROM "ModelFeedback"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY day, "type"
      `
    ),
    withinBudget("retention.rollupSports", "sweep", () =>
      prisma.$queryRaw<{ day: Date; type: string; n: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day, "type", COUNT(*)::bigint AS n
        FROM "SportsActivity"
        WHERE "createdAt" >= ${since} AND "createdAt" < ${until}
        GROUP BY day, "type"
      `
    ),
  ]);

  const rows: RollupOutcome[] = [];
  for (const row of views) rows.push({ day: key(row.day), metric: "pageviews", dimension: "", value: Number(row.n) });
  for (const row of visitors) rows.push({ day: key(row.day), metric: "unique_visitors", dimension: "", value: Number(row.n) });
  for (const row of feedback) rows.push({ day: key(row.day), metric: "model_feedback", dimension: row.type, value: Number(row.n) });
  for (const row of sports) rows.push({ day: key(row.day), metric: "sports_activity", dimension: row.type, value: Number(row.n) });

  if (rows.length === 0) return [];

  // One statement per row rather than `createMany`, because the unique key has
  // to be *updated* on conflict: a re-run of a partially completed rollup must
  // not hit a constraint error and abandon the remaining days.
  for (const row of rows) {
    const day = new Date(`${row.day}T00:00:00.000Z`);
    try {
      await prisma.$executeRaw`
        INSERT INTO "DailyMetric" ("id", "metric", "dimension", "day", "value", "updatedAt")
        VALUES (${`${row.metric}:${row.dimension}:${row.day}`}, ${row.metric}, ${row.dimension}, ${day}, ${row.value}, NOW())
        ON CONFLICT ("metric", "dimension", "day")
        DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
      `;
    } catch (err) {
      // A rollup failure must not abort the prune that follows it — but it must
      // be loud, because pruning without a completed rollup loses history.
      log.error("rollup write failed", { metric: row.metric, day: row.day, error: String(err) });
      throw err;
    }
  }

  return rows;
}

/**
 * Delete rows past each table's window.
 *
 * Ordered so that the rollup always happens first — see `runAnalyticsRetention`,
 * which is the entry point the scheduler calls. Calling this directly skips that
 * guarantee, which is why it takes an explicit `aggregated` acknowledgement.
 */
export async function pruneAnalytics(opts: { dryRun?: boolean; aggregated?: boolean } = {}): Promise<{
  outcomes: PruneOutcome[];
  totalDeleted: number;
  notes: string[];
}> {
  const dryRun = opts.dryRun === true;
  const notes: string[] = [];
  const outcomes: PruneOutcome[] = [];
  let totalDeleted = 0;

  if (!dryRun && opts.aggregated !== true) {
    notes.push(
      "Pruning refused: rollupDailyMetrics() has not been acknowledged for this run, and pruning before aggregating would delete history the console reports on."
    );
    return { outcomes, totalDeleted: 0, notes };
  }

  for (const policy of RETENTION_POLICIES) {
    if (policy.disposition === "retain") {
      outcomes.push({
        table: policy.table,
        disposition: policy.disposition,
        retentionDays: null,
        cutoff: null,
        deleted: 0,
        truncated: false,
        skipped: policy.reason,
      });
      continue;
    }

    const days = resolveRetentionDays(policy);
    if (days === null) {
      outcomes.push({
        table: policy.table,
        disposition: policy.disposition,
        retentionDays: null,
        cutoff: null,
        deleted: 0,
        truncated: false,
        skipped: `Retention disabled (${policy.envKey} unset or 0) — nothing deleted.`,
      });
      continue;
    }

    const cutoff = new Date(Date.now() - days * DAY_MS);

    try {
      const deleted = await deleteBatch(policy.table, cutoff, dryRun);
      totalDeleted += deleted.count;
      if (deleted.truncated) {
        notes.push(
          `${policy.table}: hit the ${DELETE_BATCH_LIMIT}-row cap for one run; more remain and the next run will continue.`
        );
      }
      outcomes.push({
        table: policy.table,
        disposition: policy.disposition,
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        deleted: deleted.count,
        truncated: deleted.truncated,
      });
    } catch (err) {
      log.error("prune failed", { table: policy.table, error: String(err) });
      outcomes.push({
        table: policy.table,
        disposition: policy.disposition,
        retentionDays: days,
        cutoff: cutoff.toISOString(),
        deleted: 0,
        truncated: false,
        skipped: err instanceof Error ? err.message : String(err),
      });
      notes.push(`${policy.table}: prune failed and was skipped — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { outcomes, totalDeleted, notes };
}

async function deleteBatch(table: string, cutoff: Date, dryRun: boolean): Promise<{ count: number; truncated: boolean }> {
  // Per-table predicates that are NOT just `createdAt < cutoff`. Each exception
  // is a deliberate preservation rule and is commented where it applies.
  const where = () => {
    switch (table) {
      case "notification":
        // Unread rows are kept regardless of age: a notification nobody has
        // seen is a pending obligation, not a stale record, and deleting it
        // hides it from the reader permanently.
        return { createdAt: { lt: cutoff }, read: true };
      default:
        return { createdAt: { lt: cutoff } };
    }
  };

  if (dryRun) {
    const count = await delegate(table).count({ where: where() });
    return { count, truncated: count > DELETE_BATCH_LIMIT };
  }

  // A bounded delete. `deleteMany` on a table with millions of expired rows is
  // one long transaction that can be killed midway, and a killed delete leaves
  // the work to be redone from scratch. Taking a capped slice keeps each run
  // short and lets successive runs drain the backlog.
  const ids = await delegate(table).findMany({
    where: where(),
    select: { id: true },
    take: DELETE_BATCH_LIMIT,
    orderBy: { createdAt: "asc" },
  });

  if (ids.length === 0) return { count: 0, truncated: false };

  const idList = ids.map((r: { id: string }) => r.id);
  const deleted = await delegate(table).deleteMany({ where: { id: { in: idList } } });
  return { count: deleted.count, truncated: ids.length === DELETE_BATCH_LIMIT };
}

/**
 * Minimal structural type for the delegates this module touches.
 *
 * The alternative is a `switch` returning a union of Prisma's per-model
 * delegates, which cannot be indexed without a cast anyway and would make the
 * call above unreadable. The narrow shape here is what the module actually
 * uses: count, a capped id select, and a delete by id.
 */
function delegate(table: string): {
  count: (args: { where: unknown }) => Promise<number>;
  findMany: (args: { where: unknown; select: { id: true }; take: number; orderBy: unknown }) => Promise<{ id: string }[]>;
  deleteMany: (args: { where: unknown }) => Promise<{ count: number }>;
} {
  const models: Record<string, unknown> = {
    pageView: prisma.pageView,
    modelFeedback: prisma.modelFeedback,
    sportsActivity: prisma.sportsActivity,
    notification: prisma.notification,
    sportsNotificationLog: prisma.sportsNotificationLog,
  };
  const found = models[table];
  if (!found) throw new Error(`No retention delegate registered for "${table}"`);
  return found as ReturnType<typeof delegate>;
}

/**
 * Erase a single visitor's analytics history, for a privacy deletion request.
 *
 * Deleting the rows outright rather than nulling `visitorHash` is the right
 * default: the hash is the only link between the `PageView` rows and a person,
 * and a row that has been stripped of it is not anonymised data — it is an
 * orphan nobody can ever trace, which is exactly the outcome the request asked
 * for. The daily rollups are aggregate counts with no visitor reference and
 * survive, which is honest: they never contained the personal data.
 */
export async function deleteVisitorHistory(visitorHash: string): Promise<number> {
  if (!visitorHash || visitorHash.length < 8) {
    throw new Error("deleteVisitorHistory requires a real visitor hash; refusing a short or empty value.");
  }
  const deleted = await prisma.pageView.deleteMany({ where: { visitorHash } });
  log.warn("visitor history erased", { deleted: deleted.count });
  return deleted.count;
}

/**
 * The scheduler's entry point. Aggregate first, then prune — always, in that
 * order, in one function, so no caller can get it wrong.
 */
export async function runAnalyticsRetention(
  opts: { dryRun?: boolean; rollupDays?: number } = {}
): Promise<AnalyticsRetentionReport> {
  const dryRun = opts.dryRun === true;
  const startedAt = new Date();
  const notes: string[] = [];

  // The rollup window has to cover the *longest* table-specific window that is
  // about to be pruned. Rolling up 30 days while pruning 180 would delete 150
  // days of unaggregated detail — precisely the mistake this module exists to
  // prevent, so the window is derived rather than defaulted.
  const longest = RETENTION_POLICIES.filter((p) => p.disposition === "prune")
    .map((p) => resolveRetentionDays(p) ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  const rollupDays = opts.rollupDays ?? Math.max(longest, 30);

  let rolledUp = 0;
  if (dryRun) {
    notes.push(`Dry run: no rollup rows written and nothing deleted. Rollup window would have been ${rollupDays} days.`);
  } else {
    const rows = await rollupDailyMetrics(rollupDays);
    rolledUp = rows.length;
    notes.push(`Rolled up ${rolledUp} daily metric row(s) covering ${rollupDays} days before pruning.`);
  }

  const { outcomes, totalDeleted, notes: pruneNotes } = await pruneAnalytics({ dryRun, aggregated: !dryRun });
  notes.push(...pruneNotes);

  const finishedAt = new Date();
  log.info("analytics retention complete", {
    dryRun,
    rolledUp,
    totalDeleted,
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
  });

  return {
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    rolledUp,
    rollupWindowDays: rollupDays,
    pruned: outcomes,
    totalDeleted,
    notes,
  };
}
