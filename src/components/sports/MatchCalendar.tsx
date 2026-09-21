"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { TeamCrest } from "./TeamCrest";
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
const WEEKDAYS_SHORT = ["M", "T", "W", "T", "F", "S", "S"];
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
  return [...groups.entries()]
    .map(([competition, list]) => ({
      competition,
      matches: list.slice().sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? "")),
    }))
    // Biggest competition first: a reader looking for "the Premier League games"
    // should not have to find them between two three-fixture leagues, and the
    // count that sorts them is the same one printed in the heading.
    .sort((a, b) => b.matches.length - a.matches.length || a.competition.localeCompare(b.competition));
}

/** "Today", "Tomorrow", "Sat 19 Sep" — the words a reader plans with. */
function dayWords(offsetFromToday: number, date: Date): string {
  if (offsetFromToday === 0) return "Today";
  if (offsetFromToday === 1) return "Tomorrow";
  if (offsetFromToday === -1) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

/** What the status column shows for a fixture: a minute, or a kick-off time. */
function timingOf(match: CalendarMatch): { text: string; live: boolean } {
  const live = match.status === "LIVE" || match.status === "HT";
  if (live) return { text: match.status === "HT" ? "HT" : `${match.minute ?? 0}'`, live: true };
  if (match.status === "FT") return { text: "FT", live: false };
  return { text: kickoffTime(match.kickoff), live: false };
}

/**
 * The fixture calendar.
 *
 * The old layout printed the whole month as one flat vertical stack of day
 * cards on every screen, so answering "what is on today" meant scrolling
 * through thirty days of undifferentiated rows — and the rows carried no crest,
 * which is the one piece of information a reader recognises before they read a
 * single club name.
 *
 * Now the shape follows the screen. A phone gets a week strip and one day of
 * fixtures grouped by competition: a week is the unit people plan in, and a
 * competition heading is what turns a list of rows into something scannable.
 * A desktop gets the month grid it has room for *and* the selected day beside
 * it rather than beneath it, so the two halves of the question — what is on
 * that day, and what is on this day — are answerable at the same time instead
 * of one after a scroll.
 *
 * Every fixture renders its crests, because a calendar of names is a wall of
 * text while a calendar of badges is recognisable at a glance.
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

  /** Peak fixture count in the visible grid — the busiest day sets the colour scale. */
  const busiest = useMemo(
    () => Math.max(1, ...cells.map((c) => c.day?.matches.length ?? 0)),
    [cells]
  );

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
  const dayOffset = Math.round((dateOf(dayKey).getTime() - dateOf(todayKey).getTime()) / DAY_MS);
  const weekRail = useRef<HTMLDivElement | null>(null);

  /**
   * Keep the selected day in the middle of the rail.
   *
   * The rail scrolls, so without this the current day can sit half off-screen
   * after a week step or on a narrow phone — the one cell the reader actually
   * wants is the one they would have to go looking for.
   *
   * `scrollLeft` is computed rather than using `scrollIntoView`, because
   * `scrollIntoView` is free to scroll *every* scrollable ancestor, including
   * the page: arriving on this board would yank the viewport down to the strip
   * on load.
   */
  useEffect(() => {
    const rail = weekRail.current;
    if (!rail) return;
    const cell = rail.querySelector<HTMLElement>('[data-active="true"]');
    if (!cell) return;
    const railRect = rail.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    rail.scrollLeft += cellRect.left - railRect.left - (railRect.width - cellRect.width) / 2;
  }, [dayKey, weekStart]);

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

  const todayDay = byDate.get(dayKey);
  const analysedToday = todayDay?.analysed ?? 0;

  const dayPanel = (
    <DaySection
      heading={dayWords(dayOffset, dateOf(dayKey))}
      subheading={`${dateOf(dayKey).toLocaleDateString([], { day: "numeric", month: "long" })}${analysedToday > 0 ? ` · ${analysedToday} with a pick` : ""}`}
      groups={dayGroups}
      loading={loading}
      selected={selected}
      onSelect={setSelected}
    />
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-6 xl:px-8">
      {/* ── Header: month, jump-shortcuts, refresh ───────────────────────────
          Pinned directly beneath the app navbar (h-16), the same way the score
          board's toolbar is. The month a reader is looking at, and the way to
          change it, are the two controls they come back to constantly; leaving
          them at the top of a page that scrolls through a whole month puts them
          behind a scroll every single time. */}
      <div className="sports-toolbar sticky -mx-3 border-b border-surface-900/60 bg-surface-950/95 px-3 pb-2 pt-2 backdrop-blur sm:-mx-6 sm:px-6">
        {/*
          Wraps, and every control can give up a little width.

          Month stepper + Today + Refresh is ~384px of content. On a 320px phone
          that is 49px of overflow from a nowrap row whose buttons could not
          shrink, so the whole document scrolled sideways — the same failure the
          tips toolbar had. Wrapping puts Refresh on its own line there, and the
          stepper compresses instead of pushing the row past the viewport.
        */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-surface-800/70 px-2.5 py-1 text-[11px] font-semibold text-surface-300 sm:inline-flex">
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
            <span className="min-w-[6.75rem] px-1 text-center text-xs font-semibold text-surface-200 sm:min-w-[8.5rem]">
              {monthLabel}
            </span>
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
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition",
              dayKey === todayKey
                ? "border-brand-500/50 bg-brand-500/15 text-brand-200"
                : "border-surface-800 text-surface-400 hover:text-surface-100"
            )}
          >
            Today
          </button>
          <button
            onClick={() => void load({ fresh: true })}
            className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-surface-800 px-2.5 py-1.5 text-[11px] font-medium text-surface-400 transition hover:text-surface-100"
          >
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
            <span className="sr-only sm:hidden">Refresh fixtures</span>
          </button>
        </div>

        {data ? (
          <p className="hidden text-[10px] text-surface-500 sm:block">
            {data.total} fixtures this month · {data.analysed} with a pick
            {todayDay && todayDay.matches.length > 0 ? (
              <> · {dayWords(dayOffset, dateOf(dayKey))}: {todayDay.matches.length}{todayDay.live > 0 ? ` live` : ""}</>
            ) : null}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>
      ) : null}

      {/* ── Mobile: week rail + the selected day ──────────────────────────

          The strip is a rail, not seven equal columns.

          Seven `flex-1` cells split the space that is left after the two week
          buttons: on a 320px phone that is about 34px each, and with the desk's
          1.25x type scale a 12.5px weekday and a 17.5px date do not fit in 34px
          — the label collided with its neighbours and the whole strip read as a
          grey smudge. Each day now claims a fixed, comfortable width and the
          rail scrolls when they do not all fit, which is also what makes the
          day you have selected reachable without hunting for it. */}
      <div className="md:hidden overflow-hidden">
        <div className="flex items-stretch gap-1">
          <button
            onClick={() => shiftWeek(-1)}
            className="grid shrink-0 place-items-center rounded-lg border border-surface-800 px-1 text-surface-400 transition hover:border-surface-700 hover:text-surface-50"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => shiftWeek(-1)}
            className="grid shrink-0 place-items-center rounded-xl border border-surface-800 px-1.5 text-surface-400 transition hover:border-surface-700 hover:text-surface-50"
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* `snap-x` + `snap-start`, so a flick lands a day under the thumb
              rather than between two of them. `-my-1 py-1` gives the active
              cell's ring and press-scale room inside the clipping box. */}
          <div
            ref={weekRail}
            className="scrollbar-hide -my-1 flex min-w-0 flex-1 snap-x snap-mandatory gap-1.5 overflow-x-auto px-0.5 py-1"
          >
            {week.map(({ key, day }) => {
              const date = dateOf(key);
              const active = key === dayKey;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  data-active={active}
                  onClick={() => pickDay(key)}
                  aria-current={active ? "date" : undefined}
                  aria-label={date.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                  className={cn(
                    "flex shrink-0 basis-[2.5rem] snap-start flex-col items-center justify-center rounded-lg border px-0.5 py-1.5 text-center transition active:scale-[0.97]",
                    active
                      ? "border-brand-500 bg-brand-500/15 text-brand-100"
                      : "border-surface-800 text-surface-400 hover:border-surface-700"
                  )}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide">
                    {WEEKDAYS_SHORT[(date.getUTCDay() + 6) % 7]}
                  </span>
                  <span className={cn("text-sm font-bold tabular-nums", isToday && !active && "text-brand-300")}>
                    {date.getUTCDate()}
                  </span>
                  <span className="mt-0.5 flex h-3 items-center gap-0.5">
                    {day && day.live > 0 ? (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                    ) : day && day.matches.length > 0 ? (
                      <span className="text-[10px] tabular-nums text-surface-500">{day.matches.length}</span>
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
            className="grid shrink-0 place-items-center rounded-lg border border-surface-800 px-1 text-surface-400 transition hover:border-surface-700 hover:text-surface-50"
            aria-label="Next week"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {dayPanel}
      </div>

      {/* ── Desktop: the month grid, with the day beside it ──────────────── */}
      <div className="hidden md:block">
        {loading ? (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-surface-800/60 py-16 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the calendar…
          </div>
        ) : (
          <div className="mt-3 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="min-w-0">
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <span
                    key={day}
                    className="px-1 text-center text-[11px] font-semibold uppercase tracking-wide text-surface-500"
                  >
                    {day}
                  </span>
                ))}
              </div>

              <div className="mt-1 grid grid-cols-7 gap-1">
                {cells.map((cell) => {
                  const day = cell.day;
                  const isToday = cell.key === todayKey;
                  const isSelected = cell.key === dayKey;
                  const count = day?.matches.length ?? 0;
                  return (
                    <button
                      key={cell.key}
                      onClick={() => pickDay(cell.key)}
                      aria-label={`${dateOf(cell.key).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })} — ${count} fixture${count === 1 ? "" : "s"}`}
                      className={cn(
                        "group relative flex min-h-[8.5rem] flex-col rounded-xl border p-1.5 text-left transition hover:border-brand-500/40 hover:bg-surface-900/60",
                        cell.inMonth ? "border-surface-800/70 bg-surface-900/40" : "border-surface-800/40 bg-surface-950/40",
                        isSelected && "border-brand-500/60 bg-brand-500/[0.08]",
                        isToday && !isSelected && "ring-1 ring-brand-500/50"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span
                          className={cn(
                            "text-[11px] font-bold tabular-nums",
                            isToday
                              ? "text-brand-300"
                              : cell.inMonth
                                ? "text-surface-200"
                                : "text-surface-600"
                          )}
                        >
                          {dateOf(cell.key).getUTCDate()}
                        </span>
                        {count > 0 ? (
                          <span className="flex items-center gap-1">
                            {day && day.live > 0 ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-red-400">
                                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                                {day.live}
                              </span>
                            ) : null}
                            {/* A bar rather than another number: the month's shape
                                (which weekends are busy) reads without counting. */}
                            <span
                              aria-hidden
                              className="h-1.5 rounded-full bg-brand-500/70"
                              style={{ width: `${Math.max(4, Math.round((count / busiest) * 22))}px` }}
                            />
                            <span className="text-[10px] font-semibold tabular-nums text-surface-400">{count}</span>
                            {day && day.analysed > 0 ? <Brain className="h-3 w-3 text-emerald-400/90" /> : null}
                          </span>
                        ) : null}
                      </div>

                      {day && count > 0 ? (
                        <ul className="mt-1.5 space-y-1">
                          {day.matches
                            .slice()
                            .sort((a, b) => (a.kickoff ?? "").localeCompare(b.kickoff ?? ""))
                            .slice(0, 2)
                            .map((match) => {
                              const timing = timingOf(match);
                              return (
                                <li
                                  key={`${match.provider}:${match.externalId}`}
                                  className="flex items-center gap-1 text-[10px] text-surface-400"
                                >
                                  <span
                                    className={cn(
                                      "w-[2.1rem] shrink-0 tabular-nums",
                                      timing.live ? "font-bold text-red-400" : "text-surface-500"
                                    )}
                                  >
                                    {timing.text}
                                  </span>
                                  <TeamCrest name={match.homeTeam} logo={match.homeLogo} size="sm" />
                                  <span className="truncate">{match.homeTeam}</span>
                                </li>
                              );
                            })}
                          {count > 2 ? (
                            <li className="pl-[2.1rem] text-[10px] font-medium text-surface-500">
                              +{count - 2} more
                            </li>
                          ) : null}
                        </ul>
                      ) : (
                        <span className="mt-auto text-[10px] text-surface-700">No fixtures</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The day the reader selected, beside the grid. Sticky with its own
                scroll so scanning a busy Saturday never loses the calendar. */}
            <div className="min-w-0 xl:sticky xl:top-32 xl:max-h-[calc(100vh-9rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
              {dayPanel}
            </div>
          </div>
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
 * The competition heading is what makes the list readable, and the crest is
 * what makes a row identifiable: without the heading these are just rows, and
 * without the badge a reader has to read two club names to recognise one
 * fixture. Kick-off sits in its own column so the eye can run straight down the
 * times, which is the question a calendar is actually being asked.
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
    <section className="mt-3 md:mt-0">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-surface-50">{heading}</h2>
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
            <div
              key={group.competition}
              className="overflow-hidden rounded-2xl border border-surface-800/70 bg-surface-900/40 motion-safe:animate-rise"
              style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
            >
              <div className="flex items-center gap-2 border-b border-surface-800/60 bg-surface-900/60 px-2.5 py-1.5">
                <h3 className="truncate text-[11px] font-bold uppercase tracking-wider text-surface-300">
                  {group.competition}
                </h3>
                <span className="shrink-0 text-[10px] font-semibold text-surface-500">
                  {group.matches.length}
                </span>
                <span className="h-px flex-1 bg-surface-800/70" />
              </div>

              <ul>
                {group.matches.map((match) => {
                  const timing = timingOf(match);
                  const active =
                    selected?.externalId === match.externalId && selected?.provider === match.provider;
                  return (
                    <li key={`${match.provider}:${match.externalId}`} className="border-b border-surface-800/50 last:border-b-0">
                      <button
                        onClick={() => onSelect(match)}
                        className={cn(
                          "flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition active:bg-surface-800/60",
                          active ? "bg-brand-500/[0.08]" : "hover:bg-surface-800/40"
                        )}
                      >
                        <span className="w-12 shrink-0 text-center">
                          <span
                            className={cn(
                              "inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                              timing.live ? "bg-red-500/15 text-red-400" : "text-surface-400"
                            )}
                          >
                            {timing.text}
                          </span>
                        </span>

                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="flex items-center gap-2">
                            <TeamCrest name={match.homeTeam} logo={match.homeLogo} size="lg" />
                            <span className="truncate text-sm font-medium text-surface-100">{match.homeTeam}</span>
                          </span>
                          <span className="flex items-center gap-2">
                            <TeamCrest name={match.awayTeam} logo={match.awayLogo} size="lg" />
                            <span className="truncate text-sm text-surface-300">{match.awayTeam}</span>
                          </span>
                        </span>

                        {match.prediction ? (
                          <span className="shrink-0 text-right">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300">
                              <TrendingUp className="h-3 w-3" />
                              {Math.round(match.prediction.confidence * 100)}%
                            </span>
                            <span className="mt-0.5 block max-w-[6.5rem] truncate text-[10px] text-surface-400">
                              {match.prediction.selection}
                            </span>
                          </span>
                        ) : (
                          <span className="shrink-0 text-[10px] text-surface-600">No pick</span>
                        )}

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
