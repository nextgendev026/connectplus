"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Info, Loader2, Target, TrendingUp, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

interface Summary {
  settled: number;
  won: number;
  lost: number;
  accuracy: number | null;
  avgConfidence: number | null;
  brier: number | null;
  logLoss: number | null;
  calibrationGap: number | null;
}

interface Bucket {
  label: string;
  picks: number;
  avgConfidence: number;
  actualRate: number;
  gap: number;
}

interface BreakdownRow {
  key: string;
  settled: number;
  won: number;
  accuracy: number;
  avgConfidence: number;
  brier: number;
}

interface DayPoint {
  date: string;
  settled: number;
  won: number;
  accuracy: number | null;
}

interface StrategyComparison {
  model: Summary;
  baseline: Summary;
  edgePp: number | null;
  overlap: number;
  verdict: "beats-line" | "matches-line" | "below-line" | "insufficient";
}

interface AccuracyResponse {
  generatedAt: string;
  days: number;
  overall: Summary;
  pending: number;
  strategy: StrategyComparison;
  byStrategy: BreakdownRow[];
  calibration: Bucket[];
  byMarket: BreakdownRow[];
  byCompetition: BreakdownRow[];
  series: DayPoint[];
}

const WINDOWS = [30, 60, 90];

const VERDICT_COPY: Record<StrategyComparison["verdict"], { label: string; tone: string; blurb: string }> = {
  "beats-line": {
    label: "Beats the line",
    tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
    blurb: "The model is clearing the market baseline by a meaningful margin on this sample.",
  },
  "matches-line": {
    label: "Level with the line",
    tone: "border-amber-500/40 bg-amber-500/10 text-amber-400",
    blurb: "The model is statistically indistinguishable from simply backing the favourite.",
  },
  "below-line": {
    label: "Behind the line",
    tone: "border-red-500/40 bg-red-500/10 text-red-400",
    blurb: "Following the closing odds is currently outperforming the model. Trust the record, not the narrative.",
  },
  insufficient: {
    label: "Not enough settled picks",
    tone: "border-surface-700 bg-surface-800 text-surface-300",
    blurb: "At least 20 settled picks on both sides are needed before a comparison means anything.",
  },
};

/**
 * Model record (admin).
 *
 * The audited version of the publicly visible tip record: headline accuracy,
 * calibration, per-market and per-competition breakdowns, a daily settled
 * series — and the benchmark that matters, the market baseline that simply
 * follows the closing odds.
 */
export default function ModelRecordPanel() {
  const [data, setData] = useState<AccuracyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sports/accuracy?days=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error("The model record is unavailable right now.");
      setData((await res.json()) as AccuracyResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the record");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-window-change
    void load();
  }, [load]);

  const maxDay = useMemo(
    () => Math.max(...(data?.series.map((d) => d.settled) ?? [0]), 1),
    [data]
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
            <BarChart3 className="h-4 w-4 text-brand-500" /> Model record
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-surface-500">
            Every settled pick, graded honestly — accuracy, calibration (does stated confidence match
            reality?), breakdowns by market and competition, and whether the model clears the closing
            line.
          </p>
        </div>
        <div className="flex items-center rounded-xl border p-1 border-surface-700">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium transition",
                days === w
                  ? "bg-brand-500 text-white"
                  : "text-surface-500 hover:text-surface-100"
              )}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="mt-8 flex items-center justify-center gap-2 text-sm text-surface-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Crunching the record…
        </div>
      ) : error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      ) : data ? (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Accuracy"
              value={data.overall.accuracy != null ? `${data.overall.accuracy}%` : "—"}
              sub={`${data.overall.won}/${data.overall.settled} settled`}
            />
            <Stat
              label="Avg confidence"
              value={data.overall.avgConfidence != null ? `${data.overall.avgConfidence}%` : "—"}
              icon={<Target className="h-4 w-4" />}
            />
            <Stat
              label="Calibration"
              value={
                data.overall.calibrationGap != null
                  ? `${data.overall.calibrationGap > 0 ? "+" : ""}${data.overall.calibrationGap}pp`
                  : "—"
              }
              sub={
                data.overall.calibrationGap == null
                  ? undefined
                  : Math.abs(data.overall.calibrationGap) <= 3
                    ? "well calibrated"
                    : data.overall.calibrationGap > 0
                      ? "under-confident"
                      : "over-confident"
              }
              icon={<TrendingUp className="h-4 w-4" />}
            />
            <Stat label="Brier" value={data.overall.brier != null ? data.overall.brier.toFixed(3) : "—"} sub="lower is better" />
            <Stat label="Log loss" value={data.overall.logLoss != null ? data.overall.logLoss.toFixed(3) : "—"} sub="lower is better" />
            <Stat label="Pending" value={String(data.pending)} icon={<Activity className="h-4 w-4" />} />
          </div>

          {/* Strategy comparison — the benchmark */}
          <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-surface-100">
                <Swords className="h-4 w-4 text-brand-500" /> Model vs the closing line
              </h3>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  VERDICT_COPY[data.strategy.verdict].tone
                )}
              >
                {VERDICT_COPY[data.strategy.verdict].label}
              </span>
            </div>
            <p className="mt-1 text-xs text-surface-500">{VERDICT_COPY[data.strategy.verdict].blurb}</p>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <StrategyCard
                title="Hive model"
                summary={data.strategy.model}
                tone="text-brand-400"
                highlight
              />
              <StrategyCard
                title="Market baseline"
                summary={data.strategy.baseline}
                tone="text-surface-300"
              />
              <div className="rounded-xl border p-3 border-surface-800">
                <p className="text-[11px] font-medium uppercase tracking-wide text-surface-500">Edge</p>
                <p
                  className={cn(
                    "mt-1 text-2xl font-bold tabular-nums",
                    data.strategy.edgePp == null
                      ? "text-surface-500"
                      : data.strategy.edgePp > 0
                        ? "text-emerald-400"
                        : data.strategy.edgePp < 0
                          ? "text-red-400"
                          : "text-surface-300"
                  )}
                >
                  {data.strategy.edgePp == null
                    ? "—"
                    : `${data.strategy.edgePp > 0 ? "+" : ""}${data.strategy.edgePp}pp`}
                </p>
                <p className="text-[11px] text-surface-500">
                  {data.strategy.overlap} graded pick{data.strategy.overlap === 1 ? "" : "s"} on each side
                </p>
              </div>
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-surface-500">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              The baseline backs whichever outcome the closing prices make most likely, at its
              de-vigged implied probability — no Poisson grid, no priors, no learning. It is graded
              through the identical settlement path, so the comparison is apples to apples.
            </p>
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h3 className="text-sm font-semibold text-surface-100">By strategy</h3>
              <BreakdownTable rows={data.byStrategy} emptyLabel="No settled picks yet." />
            </section>

            <section className="rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h3 className="text-sm font-semibold text-surface-100">By market</h3>
              <BreakdownTable rows={data.byMarket} emptyLabel="No settled picks by market yet." />
            </section>
          </div>

          <section className="mt-5 rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
            <h3 className="text-sm font-semibold text-surface-100">Calibration</h3>
            <p className="mt-1 text-xs text-surface-500">
              Each row is a confidence band. A trustworthy model has the observed rate close to the
              stated confidence; the two bars should line up.
            </p>
            {data.calibration.length === 0 ? (
              <p className="mt-3 text-xs text-surface-500">No settled picks in this window yet.</p>
            ) : (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {data.calibration.map((bucket) => (
                  <div key={bucket.label}>
                    <div className="flex items-center justify-between text-[11px] text-surface-500">
                      <span className="font-medium text-surface-200">{bucket.label}</span>
                      <span className="tabular-nums">
                        {bucket.picks} pick{bucket.picks === 1 ? "" : "s"} ·{" "}
                        <span
                          className={cn(
                            bucket.gap >= 0 ? "text-emerald-400" : "text-amber-400"
                          )}
                        >
                          {bucket.gap > 0 ? "+" : ""}
                          {bucket.gap}pp
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 space-y-1">
                      <CalibrationBar label="Stated" value={bucket.avgConfidence} color="bg-brand-500/70" />
                      <CalibrationBar label="Actual" value={bucket.actualRate} color="bg-emerald-500/70" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section className="rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h3 className="text-sm font-semibold text-surface-100">By competition</h3>
              <BreakdownTable rows={data.byCompetition} emptyLabel="No settled picks by competition yet." />
            </section>

            <section className="rounded-2xl border p-4 border-surface-800 bg-surface-900/40">
              <h3 className="text-sm font-semibold text-surface-100">Settled picks per day</h3>
              <div className="mt-4 flex h-28 items-end gap-1">
                {data.series.map((d) => (
                  <div
                    key={d.date}
                    className="group flex flex-1 flex-col items-center justify-end"
                    title={`${d.date}: ${d.won}/${d.settled} won${d.accuracy != null ? ` (${d.accuracy}%)` : ""}`}
                  >
                    <div
                      className="w-full rounded-t bg-brand-500/60 group-hover:bg-brand-400"
                      style={{ height: `${Math.max(2, (d.settled / maxDay) * 100)}%` }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex justify-between text-[10px] text-surface-500">
                <span>{data.series[0]?.date ?? ""}</span>
                <span>{data.series[data.series.length - 1]?.date ?? ""}</span>
              </div>
            </section>
          </div>

          <p className="mt-5 text-[11px] leading-relaxed text-surface-500">
            Picks are graded automatically when a fixture reaches full time, and numbers refresh on the
            next analyser pass (every 30 minutes). Past performance never guarantees future results;
            this panel exists so the model can be judged, not promoted.
          </p>
        </>
      ) : null}
    </div>
  );
}

function StrategyCard({
  title,
  summary,
  tone,
  highlight,
}: {
  title: string;
  summary: Summary;
  tone: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        highlight
          ? "border-brand-500/40 bg-brand-500/5"
          : "border-surface-800"
      )}
    >
      <p className={cn("text-[11px] font-semibold uppercase tracking-wide", tone)}>{title}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-surface-50">
        {summary.accuracy != null ? `${summary.accuracy}%` : "—"}
      </p>
      <p className="text-[11px] text-surface-500">
        {summary.won}/{summary.settled} settled
        {summary.avgConfidence != null ? ` · avg call ${summary.avgConfidence}%` : ""}
        {summary.brier != null ? ` · Brier ${summary.brier.toFixed(3)}` : ""}
      </p>
    </div>
  );
}

function CalibrationBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] text-surface-500">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-800">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
      <span className="w-12 shrink-0 text-right text-[10px] tabular-nums text-surface-500">{value}%</span>
    </div>
  );
}

function BreakdownTable({ rows, emptyLabel }: { rows: BreakdownRow[]; emptyLabel: string }) {
  if (rows.length === 0) return <p className="mt-3 text-xs text-surface-500">{emptyLabel}</p>;
  return (
    <div className="mt-3 max-h-72 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-surface-900">
          <tr className="text-left text-[10px] uppercase tracking-wide text-surface-500">
            <th className="py-1.5 pr-3 font-medium">Group</th>
            <th className="py-1.5 pr-3 text-right font-medium">N</th>
            <th className="py-1.5 pr-3 text-right font-medium">Hits</th>
            <th className="py-1.5 pr-3 text-right font-medium">Accuracy</th>
            <th className="py-1.5 text-right font-medium">Brier</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-800">
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="max-w-[12rem] truncate py-2 pr-3 text-surface-200">{row.key}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-surface-500">{row.settled}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-surface-500">{row.won}</td>
              <td className="py-2 pr-3 text-right font-semibold tabular-nums text-surface-50">
                {row.accuracy}%
              </td>
              <td className="py-2 text-right tabular-nums text-surface-500">{row.brier.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-3 border-surface-800 bg-surface-900/40">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-surface-500">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold text-surface-50">{value}</p>
      {sub ? <p className="text-[11px] text-surface-500">{sub}</p> : null}
    </div>
  );
}
