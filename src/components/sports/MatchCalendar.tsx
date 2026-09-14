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
  TrendingUp,
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
const DAY_MS = 86_400_000;

/** A Date for a `YYYY-MM-DD` key, at UTC midnight so it never slips a day. */
function dateOf(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function kickoffTime(iso: string | null | undefined): string {
  if (!iso) return "TBC";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "TBC";
  return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Monday of the week containing `key`. */
function weekStartOf(key: string): string {
  const date = dateOf(key);
  const offset = (date.getUTCDay() + 6) % 7;
  return keyOf(new Date(date.getTime() - offset * DAY_MS));
}

/** Group a day's fixtures by competition, keeping kick-off order inside each. */
function byCompetition(matches: CalendarMatch[]): { competition: string; matches: CalendarMatch[] }[] {
  const groups = new Map<string, CalendarMatch[]>();
  for (const match of matches) {
    // A provider can omit the competition; those fixtures still need a heading
    // rather than disappearing into an unnamed bucket.
    const competition = match.competition?.trim() || "Other fixtures";
    const list = groups.get(competition) ?? [];
    list.push(match);
    groups.set(competition, list);
  }
  return [...groups.entries()].map(([competition, list]) => ({
    competition,
    matches: list.slice().sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "")),
  }));
}

/** "Today", "Tomorrow", "Sat 19 Sep" — the words a reader plans with. */
function dayWords(offsetFromToday: number, date: Date): string {
  if (offsetFromToday === 0) return "Today";
  if (offsetFromToday === 1) return "Tomorrow";
  if (offsetFromToday === -1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The fixture calendar.
 *
 * A phone gets a week strip and one day's fixtures, grouped by competition:
 * the old layout printed the whole month as one vertical stack of day cards, so
 * a reader scrolled through thirty days of flat rows to answer "what is on
 * today". A week is the unit people actually plan in, and a competition
 * heading is what turns a list of rows into something scannable.
 *
 * Desktop keeps the month grid — there is room for it there, and a monthly view
 * is genuinely useful when you can see it at once. Selecting a day opens that
 * day's fixtures beside/below the grid.
 */
export default function MatchCalendar() {
  const now = new Date();
  const todayKey = keyOf(now);
  const [cursor, setCursor] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() });
  const [weekStart, setWeekStart] = useState(() => weekStartOf(todayKey));
  const [dayKey, setDayKey] = useState(todayKey);
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
    const from = new Date(first.getTime() - startPad * DAY_MS);
    const endPad = 6 - ((last.getUTCDay() + 6) % 7);
    const to = new Date(last.getTime() + endPad * DAY_MS);
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
    for (let at = range.from.getTime(); at <= range.to.getTime(); at += DAY_MS) {
      const key = keyOf(new Date(at));
      out.push({
        key,
        inMonth: dateOf(key).getUTCMonth() === cursor.month,
        day: byDate.get(key) ?? null,
      });
    }
    return out;
  }, [range, byDate, cursor.month]);

  /** The seven days of the strip the reader is looking at. */
  const week = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const key = keyOf(new Date(dateOf(weekStart).getTime() + i * DAY_MS));
        return { key, day: byDate.get(key) ?? null };
      }),
    [weekStart, byDate]
  );

  const dayMatches = useMemo(() => byDate.get(dayKey)?.matches ?? [], [byDate, dayKey]);
  const dayGroups = useMemo(() => byCompetition(dayMatches), [dayMatches]);
  const dayOffset = Math.round(
    (dateOf(dayKey).getTime() - dateOf(todayKey).getTime()) / DAY_MS
  );

  function shiftMonth(delta: number) {
    setCursor((current) => {
      const next = new Date(Date.UTC(current.year, current.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
    setSelected(null);
  }

  function shiftWeek(delta: number) {
    const next = keyOf(new Date(dateOf(weekStart).getTime() + delta * 7 * DAY_MS));
    setWeekStart(next);
    setDayKey(next);
    const nextDate = dateOf(next);
    setCursor({ year: nextDate.getUTCFullYear(), month: nextDate.getUTCMonth() });
    setSelected(null);
  }

  function pickDay(key: string) {
    setDayKey(key);
    setWeekStart(weekStartOf(key));
    const date = dateOf(key);
    setCursor({ year: date.getUTCFullYear(), month: date.getUTCMonth() });
    setSelected(null);
  }

  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString([], {
    month: "long",
    year: "numeric",
  });

  const analysedToday = byDate.get(dayKey)?.analysed ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-6 xl:px-8">
      {/* ── Header: month, jump-shortcuts, refresh ─────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-800/70 px-2.5 py-1 text-[11px] font-semibold text-surface-300">
          <CalendarDays className="h-3 w-3 text-brand-400" />
          Fixtures
        </span>
        <div className="flex items-center gap-1 rounded-xl border border-surface-800 bg-surface-900/70 p-1">
          <button
            onClick={() => shiftMonth(-1)}
            className="rounded-lg p-1.5 text-surface-400 transition hover:text-surface-50"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[8.5rem] px-1 text-center text-xs font-semibold text-surface-200">{monthLabel}</span>
          <button
            onClick={() => shiftMonth(1)}
            className="rounded-lg p-1.5 text-surface-400 transition hover:text-surface-50"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={() => pickDay(todayKey)}
          className="rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-medium text-surface-400 transition hover:text-surface-100"
        >
          Today
        </button>
        <button
          onClick={() => void load({ fresh: true })}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-medium text-surface-400 transition hover:text-surface-100"
        >
          <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} /> Refresh
        </button>
      </div>

      {data ? (
        <p className="mt-2 text-[11px] text-surface-500">
          {data.total} fixtures this month ·{" "}
          <span className="text-emerald-400">{data.analysed} with a prediction</span>
        </p>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      ) : null}

      {/* ── Mobile: week strip + the selected day ─────────────────────────── */}
      <div className="mt-3 md:hidden">
        <div className="flex items-center gap-1">
          <button
            onClick={() => shiftWeek(-1)}
            className="rounded-lg border border-surface-800 p-1.5 text-surface-400 transition hover:text-surface-50"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex flex-1 gap-1">
            {week.map(({ key, day }) => {
              const date = dateOf(key);
              const active = key === dayKey;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  onClick={() => pickDay(key)}
                  aria-current={active ? "date" : undefined}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-center rounded-xl border px-0.5 py-1.5 transition",
                    active
                      ? "border-brand-500 bg-brand-500/15 text-brand-100"
                      : "border-surface-800 text-surface-400 active:scale-[0.97]"
                  )}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide">{WEEKDAYS[(date.getUTCDay() + 6) % 7]}</span>
                  <span className={cn("text-sm font-bold tabular-nums", isToday && !active && "text-brand-300")}>
                    {date.getUTCDate()}
                  </span>
                  <span className="mt-0.5 flex h-3 items-center gap-0.5">
                    {day && day.live > 0 ? (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                    ) : day && day.matches.length > 0 ? (
                      <span className="text-[9px] tabular-nums text-surface-500">{day.matches.length}</span>
                    ) : (
                      <span className="h-1 w-1 rounded-full bg-surface-700" />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={() => shiftWeek(1)}
            className="rounded-lg border border-surface-800 p-1.5 text-surface-400 transition hover:text-surface-50"
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <DaySection
          heading={dayWords(dayOffset, dateOf(dayKey))}
          subheading={`${dateOf(dayKey).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}${analysedToday > 0 ? ` · ${analysedToday} with a pick` : ""}`}
          groups={dayGroups}
          loading={loading}
          selected={selected}
          onSelect={setSelected}
        />
      </div>

      {/* ── Desktop: the month grid, then the selected day beneath it ─────── */}
      <div className="hidden md:block">
        {loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-16 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the calendar…
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-7 gap-1">
              {WEEKDAYS.map((day) => (
                <span key={day} className="px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-surface-600">
                  {day}
                </span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((cell) => {
                const day = cell.day;
                const isToday = cell.key === todayKey;
                const isSelected = cell.key === dayKey;
                return (
                  <button
                    key={cell.key}
                    onClick={() => pickDay(cell.key)}
                    className={cn(
                      "min-h-[7.5rem] rounded-xl border p-2 text-left transition",
                      cell.inMonth ? "border-surface-800/70 bg-surface-900/40" : "border-surface-800/40 bg-surface-950/40",
                      isSelected && "border-brand-500/60 bg-brand-500/[0.08]",
                      isToday && !isSelected && "ring-1 ring-brand-500/50",
                      "hover:border-brand-500/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          "text-[11px] font-semibold tabular-nums",
                          isToday ? "text-brand-300" : cell.inMonth ? "text-surface-300" : "text-surface-600"
                        )}
                      >
                        {dateOf(cell.key).getUTCDate()}
                      </span>
                      {day && day.matches.length > 0 ? (
                        <span className="flex items-center gap-1.5 text-[10px] text-surface-600">
                          {day.live > 0 ? (
                            <span className="inline-flex items-center gap-1 text-red-400">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                              {day.live}
                            </span>
                          ) : null}
                          <span className="tabular-nums">{day.matches.length}</span>
                          {day.analysed > 0 ? <Brain className="h-3 w-3 text-emerald-400/80" /> : null}
                        </span>
                      ) : null}
                    </div>

                    {day && day.matches.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {day.matches
                          .slice()
                          .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""))
                          .slice(0, 3)
                          .map((match) => (
                            <li key={`${match.provider}:${match.externalId}`} className="truncate text-[10px] text-surface-400">
                              <span className="mr-1 tabular-nums text-surface-600">
                                {match.status === "LIVE" || match.status === "HT"
                                  ? match.status === "HT"
                                    ? "HT"
                                    : `${match.minute ?? 0}'`
                                  : kickoffTime(match.kickoff)}
                              </span>
                              {match.homeTeam} v {match.awayTeam}
                            </li>
                          ))}
                        {day.matches.length > 3 ? (
                          <li className="text-[9px] text-surface-600">+{day.matches.length - 3} more</li>
                        ) : null}
                      </ul>
                    ) : null}
                  </button>
                );
              })}
            </div>

            <DaySection
              heading={dayWords(dayOffset, dateOf(dayKey))}
              subheading={`${dateOf(dayKey).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}${analysedToday > 0 ? ` · ${analysedToday} with a pick` : ""}`}
              groups={dayGroups}
              loading={false}
              selected={selected}
              onSelect={setSelected}
            />
          </>
        )}
      </div>

      {selected ? (
        <div className="mt-4 motion-safe:animate-rise">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300">
              <Sparkles className="h-3.5 w-3.5" /> {selected.homeTeam} v {selected.awayTeam}
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
      ) : null}
    </div>
  );
}

/**
 * One day of fixtures, grouped by competition.
 *
 * The competition heading is what makes the list readable: without it these are
 * just rows, and a reader cannot tell a league match from a friendly or find
 * the one game they care about.
 */
function DaySection({
  heading,
  subheading,
  groups,
  loading,
  selected,
  onSelect,
}: {
  heading: string;
  subheading: string;
  groups: { competition: string; matches: CalendarMatch[] }[];
  loading: boolean;
  selected: CalendarMatch | null;
  onSelect: (match: CalendarMatch) => void;
}) {
  const total = groups.reduce((sum, g) => sum + g.matches.length, 0);

  return (
    <section className="mt-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-surface-50">{heading}</h2>
          <p className="text-[11px] text-surface-500">{subheading}</p>
        </div>
        {total > 0 ? (
          <span className="shrink-0 rounded-full bg-surface-800/70 px-2.5 py-1 text-[11px] font-semibold text-surface-300">
            {total} {total === 1 ? "match" : "matches"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-12 text-sm text-surface-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : total === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-surface-800 px-4 py-10 text-center">
          <CalendarDays className="mx-auto h-7 w-7 text-surface-600" />
          <p className="mt-2 text-sm font-medium text-surface-400">Nothing scheduled</p>
          <p className="text-xs text-surface-500">Pick another day in the week above.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {groups.map((group, index) => (
            <div key={group.competition} className="motion-safe:animate-rise" style={{ animationDelay: `${index * 45}ms` }}>
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <h3 className="truncate text-[11px] font-bold uppercase tracking-wider text-surface-400">
                  {group.competition}
                </h3>
                <span className="shrink-0 text-[10px] text-surface-600">{group.matches.length}</span>
                <span className="h-px flex-1 bg-surface-800/70" />
              </div>
              <ul className="overflow-hidden rounded-2xl border border-surface-800/70 bg-surface-900/40">
                {group.matches.map((match) => {
                  const active =
                    selected?.externalId === match.externalId && selected?.provider === match.provider;
                  const live = match.status === "LIVE" || match.status === "HT";
                  return (
                    <li key={`${match.provider}:${match.externalId}`} className="border-b border-surface-800/50 last:border-b-0">
                      <button
                        onClick={() => onSelect(match)}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition active:bg-surface-800/60",
                          active ? "bg-brand-500/[0.08]" : "hover:bg-surface-800/40"
                        )}
                      >
                        <span className="w-11 shrink-0 text-center">
                          <span
                            className={cn(
                              "inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                              live ? "bg-red-500/15 text-red-400" : "text-surface-400"
                            )}
                          >
                            {live ? (match.status === "HT" ? "HT" : `${match.minute ?? 0}'`) : kickoffTime(match.kickoff)}
                          </span>
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-surface-100">
                            {match.homeTeam} <span className="text-surface-500">v</span> {match.awayTeam}
                          </span>
                          {match.prediction ? (
                            <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-300">
                              <TrendingUp className="h-3 w-3" />
                              {match.prediction.selection} · {Math.round(match.prediction.confidence * 100)}%
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-[10px] text-surface-600">No pick yet</span>
                          )}
                        </span>

                        <ChevronRight className="h-4 w-4 shrink-0 text-surface-600" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
