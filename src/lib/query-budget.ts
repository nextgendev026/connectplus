/**
 * Query budgets, timeouts and slow-query visibility.
 *
 * The intelligence layer's queries are driven by whatever an operator or a
 * chat message asks for, and until now nothing bounded them. Two failure modes
 * followed, and both are cheap to prevent:
 *
 *   1. **No ceiling at all.** `getRegionalIntelligence()` fanned out two
 *      queries per city with no `take` on the city list, so the cost of a
 *      question about regions grew with the number of regions *in the
 *      database* — not with anything the asker chose. Prisma's default
 *      behaviour on a slow query is to wait; the request waits with it, and on
 *      serverless it is killed by the platform rather than answering.
 *   2. **No evidence.** A dashboard that got slow gave an operator nothing to
 *      point at. "The brain is slow" is not actionable; "the regional sweep
 *      took 4.2s, budget 1.5s" is.
 *
 * So this module does three small things: it names the budgets, it fails a
 * query that exceeds its budget instead of hanging, and it records every
 * overrun so the diagnostic panel can surface it.
 *
 * The timeout is a *client-side* abort, which is a deliberate limitation worth
 * stating: it releases the request and the caller, but it does not cancel the
 * statement inside Postgres — the connection keeps working until the server
 * finishes or the pool reaps it. That is enough to keep a page responsive, and
 * it is why every budget here is generous relative to the statement it guards.
 * The real fix for a query that exceeds its budget is the query, and the
 * overrun log is what points at it.
 */

import { createLogger } from "@/lib/logger";

const log = createLogger("query-budget");

/**
 * Budgets in milliseconds.
 *
 * Chosen from the shape of the statement, not from a general "fast is good":
 * an indexed point read and a grouped aggregate over a month of PageViews do
 * not deserve the same ceiling, and giving them one would either be useless for
 * the first or fatal for the second.
 */
export const QUERY_BUDGETS = {
  /** Single indexed row/aggregate. */
  point: 1_500,
  /** Grouped aggregate over a bounded window (a month of views, a week of jobs). */
  aggregate: 8_000,
  /** Raw analytical sweep across a high-volume table. */
  sweep: 15_000,
  /** Anything an operator is waiting on interactively. */
  interactive: 20_000,
} as const;

export type QueryBudget = keyof typeof QUERY_BUDGETS;

export interface SlowQuery {
  label: string;
  budget: QueryBudget;
  budgetMs: number;
  durationMs: number;
  overrunMs: number;
  at: string;
}

/** Bounded so a pathological loop cannot turn this log into a memory leak. */
const RECENT_LIMIT = 50;
const recent: SlowQuery[] = [];
let overruns = 0;

function record(entry: SlowQuery): void {
  overruns++;
  recent.push(entry);
  if (recent.length > RECENT_LIMIT) recent.shift();
  log.warn("query exceeded budget", {
    label: entry.label,
    budget: entry.budget,
    durationMs: entry.durationMs,
    overrunMs: entry.overrunMs,
  });
}

/** Read-only view for the diagnostics panel. */
export function slowQueryReport(): { overruns: number; recent: SlowQuery[] } {
  return { overruns, recent: [...recent].reverse() };
}

/** Test seam — resets the counters so a suite is not affected by earlier tests. */
export function resetQueryBudgetStats(): void {
  overruns = 0;
  recent.length = 0;
}

export class QueryTimeoutError extends Error {
  readonly label: string;
  readonly budgetMs: number;

  constructor(label: string, budgetMs: number) {
    super(`Query "${label}" exceeded its ${budgetMs}ms budget`);
    this.name = "QueryTimeoutError";
    this.label = label;
    this.budgetMs = budgetMs;
  }
}

/**
 * Run a query under a budget.
 *
 * On overrun this throws `QueryTimeoutError` rather than returning a partial
 * result, because every caller here is computing something an operator or a
 * model will read as a fact. A silently truncated "regional breakdown" is worse
 * than an error: it looks like an answer. Callers that would rather degrade
 * than fail should catch this explicitly (see `boundedOrNull`).
 *
 * A slow-but-successful query is still recorded. The budget is a reporting
 * threshold first and a kill switch second; a query at 7.9s inside an 8s budget
 * is a problem to fix, not a problem to hide.
 */
export async function withinBudget<T>(
  label: string,
  budget: QueryBudget,
  run: () => Promise<T>
): Promise<T> {
  const budgetMs = QUERY_BUDGETS[budget];
  const started = Date.now();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueryTimeoutError(label, budgetMs)), budgetMs);
  });

  try {
    const result = await Promise.race([run(), timeout]);
    const durationMs = Date.now() - started;
    // 80% is the warning line: a query that is *nearly* over budget is the one
    // that will be over budget next month, and last month's headroom is exactly
    // why nobody notices until it fails.
    if (durationMs >= budgetMs * 0.8) {
      record({ label, budget, budgetMs, durationMs, overrunMs: durationMs - budgetMs, at: new Date().toISOString() });
    }
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Degrading variant for read paths that must still answer.
 *
 * Returns null on timeout instead of throwing, and records the overrun either
 * way — so a dashboard that would rather show "unavailable" than fail can use
 * this without the overrun disappearing from the log.
 */
export async function withinBudgetOrNull<T>(
  label: string,
  budget: QueryBudget,
  run: () => Promise<T>
): Promise<T | null> {
  try {
    return await withinBudget(label, budget, run);
  } catch (err) {
    if (err instanceof QueryTimeoutError) {
      record({
        label,
        budget,
        budgetMs: err.budgetMs,
        durationMs: err.budgetMs,
        overrunMs: 0,
        at: new Date().toISOString(),
      });
      return null;
    }
    throw err;
  }
}

/** Health line for the admin diagnostics panel. */
export async function queryBudgetHealth(): Promise<{ level: "ok" | "warn"; detail: string }> {
  const { overruns, recent: rows } = slowQueryReport();
  if (rows.length === 0) {
    return { level: "ok", detail: `No query exceeded 80% of its budget in this instance's lifetime (${overruns} overruns).` };
  }
  const worst = rows.reduce((a, b) => (b.durationMs > a.durationMs ? b : a));
  return {
    level: overruns > 0 ? "warn" : "ok",
    detail: `${overruns} query overrun(s) this instance; slowest "${worst.label}" at ${worst.durationMs}ms against a ${worst.budgetMs}ms ${worst.budget} budget.`,
  };
}
