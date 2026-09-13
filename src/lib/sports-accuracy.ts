/**
 * Accuracy maths for the public model record.
 *
 * All pure and dependency-free so the dashboard's numbers can be unit-tested:
 * the point of publishing a record is that it is honest, and the way to keep it
 * honest is to make the aggregation itself auditable.
 */

export interface GradedPick {
  market: string;
  /** Model confidence in [0,1]. */
  confidence: number;
  won: boolean;
  /** ISO string or Date. */
  settledAt: string | Date;
  competition: string;
}

export interface AccuracySummary {
  settled: number;
  won: number;
  lost: number;
  /** Percentage, one decimal. Null when nothing is settled. */
  accuracy: number | null;
  avgConfidence: number | null;
  /** Lower is better. Null when nothing is settled. */
  brier: number | null;
  logLoss: number | null;
  /** avgConfidence - accuracy, as percentage points. 0 = perfectly calibrated. */
  calibrationGap: number | null;
}

const round = (n: number, dp = 3): number => Math.round(n * 10 ** dp) / 10 ** dp;

export function summarize(picks: GradedPick[]): AccuracySummary {
  if (picks.length === 0) {
    return {
      settled: 0,
      won: 0,
      lost: 0,
      accuracy: null,
      avgConfidence: null,
      brier: null,
      logLoss: null,
      calibrationGap: null,
    };
  }

  const won = picks.filter((p) => p.won).length;
  const avgConfidence = picks.reduce((n, p) => n + p.confidence, 0) / picks.length;
  const brier = picks.reduce((n, p) => n + (p.confidence - (p.won ? 1 : 0)) ** 2, 0) / picks.length;
  const logLoss =
    picks.reduce((n, p) => {
      const c = Math.min(Math.max(p.confidence, 0.001), 0.999);
      return n + (p.won ? -Math.log(c) : -Math.log(1 - c));
    }, 0) / picks.length;
  const accuracy = won / picks.length;

  return {
    settled: picks.length,
    won,
    lost: picks.length - won,
    accuracy: round(accuracy * 100, 1),
    avgConfidence: round(avgConfidence * 100, 1),
    brier: round(brier, 4),
    logLoss: round(logLoss, 4),
    calibrationGap: round((avgConfidence - accuracy) * 100, 1),
  };
}

export interface CalibrationBucket {
  label: string;
  min: number;
  max: number;
  picks: number;
  /** Mean stated confidence, percentage. */
  avgConfidence: number;
  /** Observed win rate, percentage. */
  actualRate: number;
  /** actualRate - avgConfidence; positive means the model under-claims. */
  gap: number;
}

/**
 * Bucket settled picks by stated confidence. A well-calibrated model has
 * `actualRate ≈ avgConfidence` in every bucket; a model that is overconfident
 * shows actualRate well below avgConfidence in the high buckets.
 */
export function calibrationBuckets(picks: GradedPick[], bucketSize = 10): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let min = 0; min < 100; min += bucketSize) {
    const max = Math.min(min + bucketSize, 100);
    const inBucket = picks.filter((p) => {
      const pct = p.confidence * 100;
      return pct >= min && (max === 100 ? pct <= 100 : pct < max);
    });
    if (inBucket.length === 0) continue;
    const avgConfidence = inBucket.reduce((n, p) => n + p.confidence * 100, 0) / inBucket.length;
    const actualRate = (inBucket.filter((p) => p.won).length / inBucket.length) * 100;
    buckets.push({
      label: `${min}–${max}%`,
      min,
      max,
      picks: inBucket.length,
      avgConfidence: round(avgConfidence, 1),
      actualRate: round(actualRate, 1),
      gap: round(actualRate - avgConfidence, 1),
    });
  }
  return buckets;
}

export interface BreakdownRow {
  key: string;
  settled: number;
  won: number;
  accuracy: number;
  avgConfidence: number;
  brier: number;
}

export function breakdownBy<T extends GradedPick>(picks: T[], keyOf: (p: T) => string): BreakdownRow[] {
  const groups = new Map<string, T[]>();
  for (const p of picks) {
    const key = keyOf(p) || "Unknown";
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const won = list.filter((p) => p.won).length;
      const avgConfidence = list.reduce((n, p) => n + p.confidence, 0) / list.length;
      const brier = list.reduce((n, p) => n + (p.confidence - (p.won ? 1 : 0)) ** 2, 0) / list.length;
      return {
        key,
        settled: list.length,
        won,
        accuracy: round((won / list.length) * 100, 1),
        avgConfidence: round(avgConfidence * 100, 1),
        brier: round(brier, 4),
      };
    })
    .sort((a, b) => b.settled - a.settled || b.accuracy - a.accuracy);
}

export interface StrategyComparison {
  model: AccuracySummary;
  baseline: AccuracySummary;
  /** Mean model edge over the market baseline, percentage points. */
  edgePp: number | null;
  /** Picks where both strategies were graded, i.e. the honest sample. */
  overlap: number;
  verdict: "beats-line" | "matches-line" | "below-line" | "insufficient";
}

/**
 * Compare the model against a strategy that simply follows the closing odds.
 *
 * The verdict only claims anything once there is a meaningful sample — a model
 * that is 1-0 against the line is not evidence, and the dashboard must say so.
 */
export function compareStrategies(modelPicks: GradedPick[], baselinePicks: GradedPick[]): StrategyComparison {
  const model = summarize(modelPicks);
  const baseline = summarize(baselinePicks);
  const overlap = Math.min(model.settled, baseline.settled);
  const edgePp =
    model.accuracy != null && baseline.accuracy != null
      ? round(model.accuracy - baseline.accuracy, 1)
      : null;

  let verdict: StrategyComparison["verdict"] = "insufficient";
  if (overlap >= 20 && edgePp != null) {
    if (edgePp >= 2) verdict = "beats-line";
    else if (edgePp <= -2) verdict = "below-line";
    else verdict = "matches-line";
  }

  return { model, baseline, edgePp, overlap, verdict };
}

export interface DayPoint {
  date: string;
  settled: number;
  won: number;
  accuracy: number | null;
}

/**
 * Daily settled/won counts for the last `days` days (oldest first), including
 * empty days so the chart has a continuous x-axis.
 */
export function dailySeries(picks: GradedPick[], days = 30, now: Date = new Date()): DayPoint[] {
  const safeDays = Math.min(Math.max(days, 1), 180);
  const points: DayPoint[] = [];
  const index = new Map<string, DayPoint>();
  for (let i = safeDays - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const point: DayPoint = { date, settled: 0, won: 0, accuracy: null };
    points.push(point);
    index.set(date, point);
  }

  for (const p of picks) {
    const date = new Date(p.settledAt).toISOString().slice(0, 10);
    const point = index.get(date);
    if (!point) continue;
    point.settled++;
    if (p.won) point.won++;
  }
  for (const point of points) {
    point.accuracy = point.settled > 0 ? round((point.won / point.settled) * 100, 1) : null;
  }
  return points;
}
