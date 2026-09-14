"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { calendarEndpoint } from "@/lib/sports-endpoint";
import MatchDetail, { type MatchRef } from "./MatchDetail";

interface CalendarPrediction {
  id: string;
  market: string;
  marketLabel: string;
  selection: string;
  confidence: number;
  valueEdge: number | null;
}

interface CalendarMatch extends MatchRef {
  id: string | null;
  country: string | null;
  homeLogo?: string | null;
  awayLogo?: string | null;
  predictions: CalendarPrediction[];
  prediction: CalendarPrediction | null;
}

interface CalendarDay {
  date: string;
  matches: CalendarMatch[];
  live: number;
  analysed: number;
}

interface CalendarResponse {
  generatedAt: string;
  from: string;
  to: string;
  days: CalendarDay[];
  total: number;
  analysed: number;
  sources: string[];
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A Date for a `YYYY-MM-DD` key, at UTC midnight so it never slips a day. */
function dateOf(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function kickoffTime(iso: string | null | undefined): string {
  if (!iso) return "TBC";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "TBC";
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * The fixture calendar.
 *
 * A month at a time, because that is the unit a football reader actually plans
 * in — "what is on this weekend" is answered by the Scores tab, "what does the
 * next month look like" is not. Every day shows how many of its fixtures the
 * model has already analysed, so the calendar doubles as an honest progress view
 * of the week-ahead prediction pass rather than a wall of empty rows.
 *
 * Desktop and mobile are the same component: a seven-column month grid where
 * there is room for it, and the same days as a vertical list where there is not,
 * so a phone never gets a squeezed grid and a desktop never gets a phone layout
 * stretched across the screen.
 */
export default function MatchCalendar() {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() });
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<CalendarMatch | null>(null);

  const range = useMemo(() => {
    // Whole calendar month, padded to the Monday and Sunday that frame it, so
    // the grid always reads as a calendar rather than a ragged list.
    const first = new Date(Date.UTC(cursor.year, cursor.month, 1));
    const last = new Date(Date.UTC(cursor.year, cursor.month + 1, 0));
    const startPad = (first.getUTCDay() + 6) % 7;
    const from = new Date(first.getTime() - startPad * 86_400_000);
    const endPad = 6 - ((last.getUTCDay() + 6) % 7);
    const to = new Date(last.getTime() + endPad * 86_400_000);
    return { from, to, first, last };
  }, [cursor]);

  const load = useCallback(
    async (opts: { fresh?: boolean } = {}) => {
      if (opts.fresh) setRefreshing(true);
      try {
        const res = await fetch(
          calendarEndpoint({
            from: range.from.toISOString().slice(0, 10),
            to: range.to.toISOString().slice(0, 10),
          }),
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error("The fixture calendar is unavailable right now.");
        setData((await res.json()) as CalendarResponse);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load the calendar");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-month-change
    setLoading(true);
    void load();
  }, [load]);

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarDay>();
    for (const day of data?.days ?? []) map.set(day.date, day);
    return map;
  }, [data]);

  const cells = useMemo(() => {
    const out: { key: string; inMonth: boolean; day: CalendarDay | null }[] = [];
    for (let at = range.from.getTime(); at <= range.to.getTime(); at += 86_400_000) {
      const key = new Date(at).toISOString().slice(0, 10);
      const date = dateOf(key);
      out.push({
        key,
        inMonth: date.getUTCMonth() === cursor.month,
        day: byDate.get(key) ?? null,
      });
    }
    return out;
  }, [range, byDate, cursor.month]);

  const todayKey = new Date().toISOString().slice(0, 10);

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
    setSelected(null);
  }

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-6 xl:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-800/70 px-2.5 py-1 text-[11px] font-semibold text-surface-300">
          <CalendarDays className="h-3 w-3 text-brand-400" />
          Fixture calendar
        </span>
        <div className="flex items-center gap-1 rounded-xl border border-surface-800 bg-surface-900/70 p-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="rounded-lg p-1.5 text-surface-400 transition hover:text-surface-50"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[9rem] px-1 text-center text-xs font-semibold text-surface-200">{monthLabel}</span>
          <button
            onClick={() => shiftMonth(1)}
            className="rounded-lg p-1.5 text-surface-400 transition hover:text-surface-50"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => setCursor({ year: now.getUTCFullYear(), month: now.getUTCMonth() })}
          className="rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-medium text-surface-400 transition hover:text-surface-100"
        >
          This month
        </button>
        {data ? (
          <span className="text-[11px] text-surface-500">
            {data.total} fixtures · <span className="text-emerald-400">{data.analysed} analysed</span>
            {data.sources.length > 0 ? ` · ${data.sources.join(" + ")}` : ""}
          </span>
        ) : null}
        <button
          onClick={() => void load({ fresh: true })}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-medium text-surface-400 transition hover:text-surface-100"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Refresh
        </button>
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      ) : null}

      {loading ? (
        <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-16 text-sm text-surface-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the calendar…
        </div>
      ) : (
        <>
          <div className="mt-3 hidden gap-1 md:grid md:grid-cols-7">
            {WEEKDAYS.map((day) => (
              <span key={day} className="px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-surface-600">
                {day}
              </span>
            ))}
          </div>

          <div className="mt-1 space-y-3 md:grid md:grid-cols-7 md:gap-1 md:space-y-0">
            {cells.map((cell) => {
              const day = cell.day;
              const isToday = cell.key === todayKey;
              const dayLabel = dateOf(cell.key).toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              });
              return (
                <div
                  key={cell.key}
                  className={cn(
                    "rounded-xl border p-2 md:min-h-[7.5rem]",
                    cell.inMonth ? "border-surface-800/70 bg-surface-900/40" : "border-surface-800/40 bg-surface-950/40",
                    isToday && "ring-1 ring-brand-500/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "text-[11px] font-semibold",
                        isToday ? "text-brand-300" : cell.inMonth ? "text-surface-300" : "text-surface-600"
                      )}
                    >
                      {/* A phone reads the long label; the grid has no room for it. */}
                      <span className="md:hidden">{dayLabel}</span>
                      <span className="hidden md:inline">{dateOf(cell.key).getUTCDate()}</span>
                    </span>
                    {day && day.matches.length > 0 ? (
                      <span className="flex items-center gap-1.5 text-[10px] text-surface-600">
                        {day.live > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-400">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                            {day.live}
                          </span>
                        ) : null}
                        <span>{day.matches.length}</span>
                        {day.analysed > 0 ? <Brain className="h-3 w-3 text-emerald-400/80" /> : null}
                      </span>
                    ) : null}
                  </div>

                  {day && day.matches.length > 0 ? (
                    <ul className="mt-1.5 space-y-1">
                      {day.matches
                        .slice()
                        .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""))
                        .slice(0, 5)
                        .map((match) => (
                          <li key={`${match.provider}:${match.externalId}`}>
                            <button
                              onClick={() => setSelected(match)}
                              className={cn(
                                "w-full rounded-lg px-1.5 py-1 text-left transition hover:bg-surface-800/60",
                                selected?.externalId === match.externalId && selected.provider === match.provider
                                  ? "bg-brand-500/10 ring-1 ring-brand-500/40"
                                  : ""
                              )}
                            >
                              <div className="flex items-center gap-1.5">
                                <span className="shrink-0 text-[10px] tabular-nums text-surface-500">
                                  {match.status === "LIVE" || match.status === "HT"
                                    ? match.status === "HT"
                                      ? "HT"
                                      : `${match.minute ?? 0}'`
                                    : kickoffTime(match.kickoff)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-[11px] text-surface-200">
                                  {match.homeTeam} <span className="text-surface-600">v</span> {match.awayTeam}
                                </span>
                                {match.prediction ? (
                                  <span
                                    className="shrink-0 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-bold text-emerald-300"
                                    title={`${match.prediction.marketLabel}: ${match.prediction.selection} at ${Math.round(
                                      match.prediction.confidence * 100
                                    )}%`}
                                  >
                                    {Math.round(match.prediction.confidence * 100)}%
                                  </span>
                                ) : null}
                              </div>
                              <p className="truncate text-[9px] text-surface-600">{match.competition}</p>
                            </button>
                          </li>
                        ))}
                      {day.matches.length > 5 ? (
                        <li className="px-1.5 text-[9px] text-surface-600">+{day.matches.length - 5} more</li>
                      ) : null}
                    </ul>
                  ) : (
                    <p className="mt-2 hidden text-[10px] text-surface-700 md:block">—</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {selected ? (
        <div className="mt-5">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" /> Analysis for {selected.homeTeam} v {selected.awayTeam}
            </span>
            <span className="text-[10px] text-surface-500">{selected.competition}</span>
            <button
              onClick={() => setSelected(null)}
              className="ml-auto rounded-lg border border-surface-800 px-2 py-1 text-[10px] text-surface-400 transition hover:text-surface-100"
            >
              Close
            </button>
          </div>
          <MatchDetail match={selected} pollSeconds={60} />
        </div>
      ) : (
        <p className="mt-4 text-[11px] text-surface-600">
          Pick any fixture to open its full analysis — timeline, team stats, lineups with connectPlus Ratings,
          attack momentum, shot map and the model&apos;s picks on it.
        </p>
      )}
    </div>
  );
}
