/**
 * Match detail — the deep view behind one fixture.
 *
 * Everything here comes from ESPN's **public, keyless** summary endpoint. That
 * matters: a sports desk that needs a paid feed to show a timeline is a sports
 * desk that shows an empty panel when the budget changes. What the public feed
 * genuinely provides, and what this module therefore claims, is:
 *
 *   provider data   key events (goal / card / substitution, with the minute, the
 *                   player and the provider's own sentence), team statistics
 *                   (28 of them: possession, shots, passes, tackles, clearances…),
 *                   full lineups with formation, starters, bench, squad numbers
 *                   and position, per-player stats, head-to-head series, venue,
 *                   attendance and the pre-match odds.
 *   derived here    attack **momentum**, a **connectPlus Rating** per player, and
 *                   a **shot map** from the provider's goal coordinates. Each is
 *                   labelled as derived wherever it is rendered, because a
 *                   computed number and a measured one deserve different trust.
 *
 * What it deliberately does NOT have, and will not pretend to: heatmaps (they
 * need positional tracking, which no free feed publishes), market value, player
 * height, career analytics, and the "300+ stats" of a commercial provider. The
 * `coverage` object reports exactly which of those are missing so the UI can say
 * so instead of rendering an empty box — an unexplained blank panel is how a
 * product looks broken when it is merely honest about its sources.
 */

import { cacheGet, cacheSet } from "@/lib/redis";
import { createLogger } from "@/lib/logger";
import { espnLeagueSlug, resolveEspnEventId } from "@/lib/sports";

const log = createLogger("sports-detail");

const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const FETCH_TIMEOUT_MS = 9_000;
/** Live detail changes by the minute; a finished one never changes. */
const TTL_LIVE = 20;
const TTL_FINISHED = 600;
const TTL_PRE = 180;

/* ------------------------------------------------------------------ */
/* types                                                              */
/* ------------------------------------------------------------------ */

export type EventKind =
  | "goal"
  | "own-goal"
  | "penalty"
  | "yellow"
  | "red"
  | "sub"
  | "kickoff"
  | "halftime"
  | "fulltime"
  | "other";

export interface MatchEvent {
  id: string;
  minute: number | null;
  /** The provider's minute label, e.g. "45'+3'". */
  minuteLabel: string;
  kind: EventKind;
  teamName: string | null;
  players: string[];
  text: string;
  scoring: boolean;
  /** Goal/shot position on a 0-100 pitch when the provider supplies it. */
  position: { x: number; y: number } | null;
}

export interface TeamStat {
  name: string;
  label: string;
  home: number | null;
  away: number | null;
  homeDisplay: string;
  awayDisplay: string;
  /** "%" for percentages, "" otherwise — drives the UI suffix. */
  unit: string;
  /** True when a higher number is better (fouls are not). */
  higherIsBetter: boolean;
}

export interface LineupPlayer {
  id: string;
  name: string;
  shortName: string;
  jersey: string | null;
  position: string | null;
  starter: boolean;
  subbedIn: boolean;
  subbedOut: boolean;
  headshot: string | null;
  /** connectPlus Rating — derived, see `computePlayerRating`. */
  rating: number | null;
  /** The two or three stats that actually moved the rating. */
  ratingBasis: string[];
  stats: { name: string; label: string; value: string }[];
}

export interface TeamLineup {
  side: "home" | "away";
  teamId: string | null;
  teamName: string;
  formation: string | null;
  starters: LineupPlayer[];
  bench: LineupPlayer[];
  averageRating: number | null;
}

export interface MomentumPoint {
  /** Minute the window closes on. */
  minute: number;
  /** −1..1, positive towards the home side — matches a two-sided bar. */
  value: number;
}

export interface MatchDetail {
  found: boolean;
  provider: string;
  externalId: string;
  competition: string | null;
  homeTeam: string;
  awayTeam: string;
  status: string | null;
  /** Where this came from, so the UI can cite it. */
  source: "espn-summary" | "unavailable";
  sourceUrl: string | null;
  events: MatchEvent[];
  stats: TeamStat[];
  lineups: TeamLineup[];
  momentum: MomentumPoint[];
  /** Goals and shots that carry coordinates — the shot map. */
  shots: MatchEvent[];
  /** Recent play-by-play lines, newest first. */
  commentary: { minute: string; text: string }[];
  /** The written read on this fixture, built by `buildInsights`. */
  insights: MatchInsight[];
  h2h: { title: string; summary: string; label: string } | null;
  lastFive: { team: string; games: string[] }[];
  info: {
    venue: string | null;
    attendance: string | null;
    oddsSummary: string | null;
  };
  /** Field names this module computed rather than read. */
  derived: string[];
  /** Which capabilities this fixture's data actually supports. */
  coverage: {
    timeline: boolean;
    teamStats: boolean;
    lineups: boolean;
    perPlayerStats: boolean;
    momentum: boolean;
    shotMap: boolean;
    h2h: boolean;
    /* Explicitly unsupported by any keyless feed we have. */
    heatmaps: false;
    playerMarketValue: false;
    careerAnalytics: false;
  };
  note?: string;
}

/* ------------------------------------------------------------------ */
/* pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

/** ESPN's event label → our vocabulary. */
export function eventKind(typeText: string | null | undefined): EventKind {
  const t = (typeText ?? "").toLowerCase();
  if (t.includes("own goal")) return "own-goal";
  // The provider labels a converted spot kick "Penalty - Scored", which carries
  // neither the word "goal" nor an obvious marker, so it is matched before the
  // generic goal rule — otherwise every penalty vanished from the timeline.
  if (t.includes("penalty")) return /miss|saved|save\b/.test(t) ? "other" : "penalty";
  if (t.includes("goal")) return "goal";
  if (t.includes("red card") || t.includes("second yellow")) return "red";
  if (t.includes("yellow card")) return "yellow";
  if (t.includes("substitution")) return "sub";
  if (t.includes("kickoff") || t.includes("start")) {
    return t.includes("2nd half") ? "other" : "kickoff";
  }
  if (t.includes("halftime") || t.includes("half time")) return "halftime";
  if (t.includes("end regular") || t.includes("full")) return "fulltime";
  return "other";
}

/** "45'+3'" → 45 (stoppage time folds into the minute it belongs to). */
export function parseMinute(label: string | null | undefined, fallbackValue?: number | null): number | null {
  if (!label) {
    // ESPN also sends clock.value in seconds; that is a reliable second source.
    return typeof fallbackValue === "number" && fallbackValue >= 0
      ? Math.floor(fallbackValue / 60)
      : null;
  }
  const m = label.match(/(\d+)/);
  if (!m) return null;
  return Number(m[1]);
}

/** Team stats arrive as display strings ("62.5%", "10", "1.24"). */
export function parseStatValue(display: string | null | undefined): number | null {
  if (display == null) return null;
  const cleaned = String(display).replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Fouls, cards and offsides are the stats where more is worse. */
const LOWER_IS_BETTER = new Set([
  "foulsCommitted",
  "yellowCards",
  "redCards",
  "offsides",
  "goalsConceded",
]);

export function statsHigherIsBetter(name: string): boolean {
  return !LOWER_IS_BETTER.has(name);
}

/* ------------------------------------------------------------------ */
/* momentum                                                           */
/* ------------------------------------------------------------------ */

/**
 * How much each action moves the momentum bar.
 *
 * The weights are the argument for reading the graph at all: a goal is worth
 * several shots, a shot on target more than one off target, and a corner more
 * than a throw because it carries a real chance. Fouls push *against* the team
 * that committed them, which is why they are negative — sustained fouling is
 * the clearest signal of a side under pressure.
 */
const ACTION_WEIGHT = {
  goal: 3.0,
  saved: 1.6,
  off: 1.0,
  corner: 1.2,
  offside: -0.4,
  foul: -0.5,
  yellow: -0.8,
  sub: 0.1,
} as const;

export type ActionKind = keyof typeof ACTION_WEIGHT;

/**
 * Classify one play-by-play line.
 *
 * Returns null for lines that carry no directional signal ("Lineups are
 * announced…", "End Delay"), so they neither inflate nor dilute the graph.
 */
export function classifyCommentary(text: string): ActionKind | null {
  const t = text.trim();
  if (/^goal!/i.test(t) || /^own goal!/i.test(t)) return "goal";
  if (/attempt saved/i.test(t) || /^save/i.test(t)) return "saved";
  if (/attempt missed/i.test(t) || /attempt blocked/i.test(t)) return "off";
  if (/corner/i.test(t)) return "corner";
  if (/offside/i.test(t)) return "offside";
  if (/yellow card/i.test(t) || /red card/i.test(t)) return "yellow";
  if (/^substitution/i.test(t)) return "sub";
  if (/foul/i.test(t)) return "foul";
  return null;
}

/**
 * Which team a commentary line belongs to.
 *
 * ESPN writes the side into the sentence in a handful of shapes — "(Brentford)",
 * "Substitution, Brentford.", "Offside, Bournemouth." — so the team name is
 * matched as a whole phrase rather than guessed from surnames. Ambiguity is
 * resolved to null, because crediting the wrong side with an attack poisons the
 * whole graph rather than one line of it.
 */
export function attributeTeam(text: string, homeTeam: string, awayTeam: string): "home" | "away" | null {
  const haystack = text.toLowerCase();
  const hits = (name: string) => {
    const needle = name.toLowerCase().trim();
    if (!needle) return false;
    return haystack.includes(needle);
  };
  const home = hits(homeTeam);
  const away = hits(awayTeam);
  if (home && !away) return "home";
  if (away && !home) return "away";
  return null;
}

/**
 * Attack momentum: where the pressure was, minute by minute.
 *
 * Built from the play-by-play rather than invented. Each action adds its weight
 * to the side that produced it, the per-minute totals are smoothed with an
 * exponential decay so one goal does not draw a one-minute spike, and the series
 * is normalised to −1..1 where positive means the home side is on top. The
 * output is a *relative* measure of pressure in this match only — it is not a
 * claim about possession or quality.
 */
export function computeMomentum(
  entries: { minute: number | null; text: string }[],
  homeTeam: string,
  awayTeam: string,
  opts: { bucketMinutes?: number; decay?: number; buckets?: number } = {}
): MomentumPoint[] {
  const bucketMinutes = opts.bucketMinutes ?? 5;
  const decay = opts.decay ?? 0.72;
  const buckets = opts.buckets ?? 18; // 18 × 5' = the 90 minutes

  const raw = new Map<number, number>();
  for (const entry of entries) {
    if (entry.minute == null) continue;
    const action = classifyCommentary(entry.text);
    if (!action) continue;
    const side = attributeTeam(entry.text, homeTeam, awayTeam);
    if (!side) continue;
    const bucket = Math.min(buckets, Math.max(1, Math.ceil(entry.minute / bucketMinutes) || 1));
    const weight = ACTION_WEIGHT[action] * (side === "home" ? 1 : -1);
    raw.set(bucket, (raw.get(bucket) ?? 0) + weight);
  }

  const series: MomentumPoint[] = [];
  let carry = 0;
  for (let i = 1; i <= buckets; i++) {
    const here = raw.get(i) ?? 0;
    carry = carry * decay + here;
    series.push({ minute: i * bucketMinutes, value: Number(carry.toFixed(3)) });
  }

  // Normalise on the largest absolute swing so the bar fills its full width on a
  // one-sided match instead of staying flat because the scale was arbitrary.
  const peak = series.reduce((m, p) => Math.max(m, Math.abs(p.value)), 0);
  if (peak <= 0) return series;
  return series.map((p) => ({ ...p, value: Number((p.value / peak).toFixed(3)) }));
}

/* ------------------------------------------------------------------ */
/* connectPlus Rating                                                 */
/* ------------------------------------------------------------------ */

export interface RatingResult {
  rating: number | null;
  basis: string[];
}

/**
 * connectPlus Rating — a per-player score from the stats the feed actually
 * publishes.
 *
 * Deliberately conservative and explainable: every term is a named stat, the
 * result is clamped to 3.0–10.0 so one freak game cannot produce an absurd
 * headline, and the two largest contributions are returned so a reader can see
 * *why* a number is what it is. Goalkeepers are scored on a different basis
 * (saves and goals conceded) because grading a keeper on shots taken is
 * meaningless.
 *
 * No stat set means no rating. Returning a made-up 6.5 for a player we know
 * nothing about would be the single most misleading thing this module could do.
 */
export function computePlayerRating(
  stats: Record<string, number>,
  position?: string | null
): RatingResult {
  const has = (k: string) => typeof stats[k] === "number" && Number.isFinite(stats[k]);
  const get = (k: string) => (has(k) ? stats[k]! : 0);

  if (!has("appearances") && Object.keys(stats).length === 0) {
    return { rating: null, basis: [] };
  }

  const isKeeper = /goalkeeper|keeper|\bG\b/i.test(position ?? "");
  const contributions: { label: string; value: number }[] = [];
  let rating = 6.0;
  contributions.push({ label: "appearance", value: 0 });

  const add = (label: string, value: number) => {
    if (value === 0) return;
    rating += value;
    contributions.push({ label, value });
  };

  if (isKeeper) {
    add("saves", Math.min(1.4, get("saves") * 0.18));
    add("goals conceded", -Math.max(0, get("goalsConceded") - 1) * 0.45);
  } else {
    add("goals", get("totalGoals") * 1.1);
    add("assists", get("goalAssists") * 0.7);
    add("shots on target", Math.min(0.6, get("shotsOnTarget") * 0.15));
    add("chances won", Math.min(0.3, get("foulsSuffered") * 0.05));
  }

  add("own goals", -get("ownGoals") * 1.0);
  add("yellow card", -get("yellowCards") * 0.5);
  add("red card", -get("redCards") * 1.5);
  add("fouls", -Math.min(0.45, get("foulsCommitted") * 0.15));

  const rating10 = Math.min(10, Math.max(3, Math.round(rating * 10) / 10));

  // Name the two biggest movers, ignoring the appearance baseline.
  const basis = contributions
    .filter((c) => c.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
    .map((c) => `${c.value > 0 ? "+" : ""}${c.value.toFixed(2)} ${c.label}`);

  return { rating: rating10, basis };
}

/** Average of the non-null ratings, for the "team summary" chips. */
export function averageRating(players: { rating: number | null }[]): number | null {
  const rated = players.filter((p) => p.rating != null) as { rating: number }[];
  if (rated.length === 0) return null;
  return Math.round((rated.reduce((s, p) => s + p.rating, 0) / rated.length) * 10) / 10;
}

/* ------------------------------------------------------------------ */
/* ESPN summary fetch + normalisation                                  */
/* ------------------------------------------------------------------ */

/**
 * `espn:eng.1:401879285` → the pieces needed to address the summary endpoint.
 *
 * The league segment may be a slug (`eng.1`) or the provider's display name
 * (`Serie A`): the scoreboard adapter has stored the display name, and a fixture
 * persisted that way must not lose its analysis just because the slug is what the
 * summary endpoint wants. `espnLeagueSlug` reconciles the two in both directions.
 * A name we cannot resolve addresses nothing, so it resolves to null and the
 * caller reports the fixture as unsupported rather than fetching the wrong URL.
 */
export function parseEspnId(externalId: string): { league: string; eventId: string } | null {
  const m = externalId.match(/^espn:([^:]+):(\d+)$/i);
  if (!m) return null;
  const league = espnLeagueSlug(m[1]!);
  if (!league) return null;
  return { league, eventId: m[2]! };
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function normalizeEvent(row: unknown): MatchEvent | null {
  const e = obj(row);
  const type = obj(e.type);
  const kind = eventKind(str(type.text));
  const clock = obj(e.clock);
  const minuteLabel = str(clock.displayValue) ?? "";
  const minute = parseMinute(minuteLabel, num(clock.value));
  const players = arr(e.participants)
    .map((p) => str(obj(obj(p).athlete).displayName) ?? str(obj(obj(p).athlete).shortName))
    .filter((n): n is string => Boolean(n));

  // Goal coordinates: ESPN anchors the shot with fieldPosition* (0-100 across)
  // and goalPositionY (0-100 down the pitch). Either alone is enough to place a
  // marker; with neither, the shot simply is not drawn.
  const x = num(e.fieldPositionX) ?? num(e.fieldPosition2X);
  const y = num(e.goalPositionY) ?? num(e.fieldPositionY) ?? num(e.fieldPosition2Y);
  const position = x != null && y != null ? { x, y } : null;

  const text = str(e.text) ?? str(e.shortText) ?? "";
  if (!text && kind === "other") return null;

  return {
    id: String(e.id ?? `${minute}-${kind}-${text.slice(0, 20)}`),
    minute,
    minuteLabel,
    kind,
    teamName: str(obj(e.team).displayName),
    players,
    text,
    scoring: e.scoringPlay === true || kind === "goal" || kind === "own-goal" || kind === "penalty",
    position,
  };
}

function normalizeTeamStats(boxscore: Json): TeamStat[] {
  const teams = arr(boxscore.teams);
  if (teams.length < 2) return [];
  const home = obj(teams[0]);
  const away = obj(teams[1]);
  const awayByName = new Map(
    arr(away.statistics).map((s) => {
      const row = obj(s);
      return [String(row.name ?? ""), row];
    })
  );

  const out: TeamStat[] = [];
  for (const raw of arr(home.statistics)) {
    const row = obj(raw);
    const name = String(row.name ?? "");
    if (!name) continue;
    const other = awayByName.get(name) ?? {};
    out.push({
      name,
      label: str(row.label) ?? str(row.displayName) ?? name,
      home: parseStatValue(str(row.displayValue)),
      away: parseStatValue(str(other.displayValue)),
      homeDisplay: str(row.displayValue) ?? "—",
      awayDisplay: str(other.displayValue) ?? "—",
      unit: (str(row.displayValue) ?? "").includes("%") ? "%" : "",
      higherIsBetter: statsHigherIsBetter(name),
    });
  }
  return out;
}

const RATING_STAT_KEYS = new Set([
  "appearances",
  "totalGoals",
  "goalAssists",
  "shotsOnTarget",
  "totalShots",
  "saves",
  "goalsConceded",
  "ownGoals",
  "yellowCards",
  "redCards",
  "foulsCommitted",
  "foulsSuffered",
  "offsides",
  "subIns",
]);

function normalizeLineups(rosters: unknown[], homeTeam: string, awayTeam: string): TeamLineup[] {
  // ESPN orders rosters home-first, but matching on the team name is cheap and
  // survives a provider that reorders them.
  const ordered = [...rosters].sort((a, b) => {
    const nameA = str(obj(obj(a).team).displayName) ?? "";
    const nameB = str(obj(obj(b).team).displayName) ?? "";
    if (nameA === homeTeam) return -1;
    if (nameB === homeTeam) return 1;
    return 0;
  });

  return ordered.map((raw, index) => {
    const side: "home" | "away" = index === 0 ? "home" : "away";
    const team = obj(obj(raw).team);
    const squad = arr(obj(raw).roster);

    const players: LineupPlayer[] = squad
      .map((p) => {
        const row = obj(p);
        const athlete = obj(row.athlete);
        const statsMap: Record<string, number> = {};
        const stats: LineupPlayer["stats"] = [];
        for (const s of arr(row.stats)) {
          const stat = obj(s);
          const key = String(stat.name ?? "");
          if (!key) continue;
          const value = num(stat.value) ?? parseStatValue(str(stat.displayValue));
          if (value == null) continue;
          statsMap[key] = value;
          // Only the stats a reader can use in a table; the rest are noise here.
          if (RATING_STAT_KEYS.has(key) && value !== 0) {
            stats.push({
              name: key,
              label: str(stat.shortDisplayName) ?? str(stat.displayName) ?? key,
              value: str(stat.displayValue) ?? String(value),
            });
          }
        }

        const position = str(obj(row.position).displayName) ?? str(obj(row.position).abbreviation);
        const { rating, basis } = computePlayerRating(statsMap, position);
        const name = str(athlete.displayName) ?? str(athlete.shortName) ?? "Unknown";

        return {
          id: String(athlete.id ?? name),
          name,
          shortName: str(athlete.shortName) ?? name,
          jersey: str(row.jersey),
          position,
          starter: row.starter === true,
          subbedIn: row.subbedIn === true,
          subbedOut: row.subbedOut === true,
          headshot: str(obj(athlete.headshot).href),
          rating,
          ratingBasis: basis,
          stats,
        };
      })
      .filter((p) => p.name !== "Unknown");

    const starters = players.filter((p) => p.starter);
    const bench = players.filter((p) => !p.starter);

    return {
      side,
      teamId: str(team.id),
      teamName: str(team.displayName) ?? (side === "home" ? homeTeam : awayTeam),
      formation: str(obj(raw).formation),
      starters,
      bench,
      averageRating: averageRating(starters),
    };
  });
}

function normalizeCommentary(commentary: unknown[]): { minute: string; text: string }[] {
  return commentary
    .map((c) => {
      const row = obj(c);
      const text = str(row.text);
      if (!text) return null;
      return { minute: str(obj(row.time).displayValue) ?? "", text };
    })
    .filter((c): c is { minute: string; text: string } => c !== null)
    .slice(-40)
    .reverse();
}

/* ------------------------------------------------------------------ */
/* analysis                                                           */
/* ------------------------------------------------------------------ */

export interface MatchInsight {
  label: string;
  text: string;
  /** `measured` = read from the provider. `derived` = computed by us. */
  basis: "measured" | "derived";
}

/**
 * Estimated expected goals from the shot counts the feed publishes.
 *
 * A keyless feed rarely carries a provider xG, but shots and shots on target are
 * always there, so this converts them: a shot on target is worth far more than an
 * off-target one, and the baselines are the widely-used conversion rates rather
 * than anything fitted to our own picks. It is an ESTIMATE and every surface that
 * renders it says so — quietly presenting an estimate as a provider metric would
 * be exactly the kind of number a reader cannot check.
 */
export function estimateExpectedGoals(shots: number | null, onTarget: number | null): number | null {
  const total = shots ?? 0;
  const target = onTarget ?? 0;
  if (total <= 0) return null;
  const off = Math.max(0, total - target);
  return Math.round((target * 0.306 + off * 0.032) * 100) / 100;
}

function stat(detail: MatchDetail, ...names: string[]): TeamStat | undefined {
  const wanted = names.map((n) => n.toLowerCase());
  return detail.stats.find((s) => wanted.includes(s.name.toLowerCase()));
}

function leader(stat: TeamStat | undefined): "home" | "away" | null {
  if (!stat || stat.home == null || stat.away == null || stat.home === stat.away) return null;
  const homeWins = stat.higherIsBetter ? stat.home > stat.away : stat.home < stat.away;
  return homeWins ? "home" : "away";
}

/**
 * The written read on a fixture, built only from what was actually measured.
 *
 * Each line is a claim with its evidence attached ("58% of the ball", "7 shots"),
 * and every insight that rests on our own arithmetic says so. Insights with no
 * data behind them are omitted rather than padded with football-shaped filler,
 * which is the difference between analysis and a horoscope.
 */
export function buildInsights(detail: MatchDetail): MatchInsight[] {
  const out: MatchInsight[] = [];
  const home = detail.homeTeam;
  const away = detail.awayTeam;
  const side = (s: "home" | "away") => (s === "home" ? home : away);

  if (!detail.found) return out;

  /* 1. Who is on top right now. The most time-sensitive line on the page. */
  if (detail.momentum.length > 0) {
    const window = detail.momentum.slice(-3); // the last 15 minutes
    const avg = window.reduce((sum, p) => sum + p.value, 0) / window.length;
    if (Math.abs(avg) >= 0.25) {
      out.push({
        label: "Pressuring",
        basis: "derived",
        text: `${side(avg > 0 ? "home" : "away")} have been on top over the last 15 minutes (attack momentum ${avg > 0 ? "+" : "−"}${Math.abs(avg).toFixed(2)}).`,
      });
    }
  }

  /* 2. Possession, quoted as the provider measured it. */
  const possession = stat(detail, "possessionPct", "possession");
  if (possession && possession.home != null && possession.away != null) {
    const who = (possession.home ?? 0) >= (possession.away ?? 0) ? "home" : "away";
    out.push({
      label: "Possession",
      basis: "measured",
      text: `${side(who)} have had more of the ball — ${possession.homeDisplay} to ${possession.awayDisplay}.`,
    });
  }

  /* 3. Shots and the estimate built from them. */
  const shots = stat(detail, "totalShots", "shots");
  const onTarget = stat(detail, "shotsOnTarget", "shotsontarget");
  if (shots && shots.home != null && shots.away != null) {
    const who = leader(shots) ?? "home";
    const targetText =
      onTarget && onTarget.home != null && onTarget.away != null
        ? `, ${onTarget.home} of them on target`
        : "";
    out.push({
      label: "Shots",
      basis: "measured",
      text: `${side(who)} lead the shooting — ${shots.home} to ${shots.away}${targetText}.`,
    });

    const xgHome = estimateExpectedGoals(shots.home, onTarget?.home ?? null);
    const xgAway = estimateExpectedGoals(shots.away, onTarget?.away ?? null);
    if (xgHome != null && xgAway != null) {
      out.push({
        label: "Expected goals (estimated)",
        basis: "derived",
        text: `Chance quality works out near ${xgHome.toFixed(2)}–${xgAway.toFixed(2)} — estimated from shot volume and accuracy, since this feed publishes no provider xG.`,
      });
    }
  }

  /* 4. Discipline, only when it is actually a story. */
  const cards = stat(detail, "yellowCards");
  const reds = stat(detail, "redCards");
  const totalCards = (cards?.home ?? 0) + (cards?.away ?? 0);
  const totalReds = (reds?.home ?? 0) + (reds?.away ?? 0);
  if (totalReds > 0 || totalCards >= 4) {
    out.push({
      label: "Discipline",
      basis: "measured",
      text:
        totalReds > 0
          ? `${totalReds} red card${totalReds > 1 ? "s" : ""} and ${totalCards} booking${totalCards === 1 ? "" : "s"} so far — the game has an edge to it.`
          : `${totalCards} bookings already, with no reds yet.`,
    });
  }

  /* 5. The best player on the pitch, from the connectPlus Rating. */
  const rated = detail.lineups
    .flatMap((l) => l.starters.map((p) => ({ ...p, team: l.teamName })))
    .filter((p) => p.rating != null)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  const best = rated[0];
  if (best && best.rating != null && best.rating > 6) {
    out.push({
      label: "Standout",
      basis: "derived",
      text: `${best.name} (${best.team}) has the highest connectPlus Rating on the pitch at ${best.rating.toFixed(1)}${best.ratingBasis.length > 0 ? ` — ${best.ratingBasis.join(", ")}` : ""}.`,
    });
  }

  /* 6. Shape, when both sides' formations are published. */
  const shapes = detail.lineups.filter((l) => l.formation);
  if (shapes.length === 2) {
    out.push({
      label: "Shape",
      basis: "measured",
      text: `${shapes[0]!.teamName} line up ${shapes[0]!.formation}; ${shapes[1]!.teamName} with ${shapes[1]!.formation}.`,
    });
  }

  /* 7. The historical edge, straight from the provider's own series. */
  if (detail.h2h?.summary) {
    out.push({ label: "Head to head", basis: "measured", text: detail.h2h.summary });
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* public entry point                                                  */
/* ------------------------------------------------------------------ */

async function fetchSummary(league: string, eventId: string, sport = "soccer"): Promise<Json | null> {
  const url = `${ESPN_BASE}/${sport}/${league}/summary?event=${encodeURIComponent(eventId)}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "connectPlus/1.0 (+sports desk)" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Json;
  } catch (err) {
    log.warn("espn summary fetch failed", {
      league,
      eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

const EMPTY_COVERAGE: MatchDetail["coverage"] = {
  timeline: false,
  teamStats: false,
  lineups: false,
  perPlayerStats: false,
  momentum: false,
  shotMap: false,
  h2h: false,
  heatmaps: false,
  playerMarketValue: false,
  careerAnalytics: false,
};

/**
 * Load the deep view for one fixture.
 *
 * Only ESPN-sourced fixtures have a summary endpoint, so anything else returns
 * `found: false` with a note — the analysis panel then shows the predictions and
 * head-to-head it does have rather than an empty shell pretending to load.
 * Results are cached with a TTL that follows the match state: seconds while it is
 * live, ten minutes once it is done.
 */
export async function getMatchDetail(input: {
  externalId: string;
  provider: string;
  homeTeam: string;
  awayTeam: string;
  competition?: string | null;
  competitionId?: string | null;
  /** Used to find the fixture on ESPN when its own provider does not carry it. */
  kickoff?: Date | string | null;
  status?: string | null;
  sport?: string;
  fresh?: boolean;
}): Promise<MatchDetail> {
  const base: MatchDetail = {
    found: false,
    provider: input.provider,
    externalId: input.externalId,
    competition: input.competition ?? null,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    status: input.status ?? null,
    source: "unavailable",
    sourceUrl: null,
    events: [],
    stats: [],
    lineups: [],
    momentum: [],
    shots: [],
    commentary: [],
    insights: [],
    h2h: null,
    lastFive: [],
    info: { venue: null, attendance: null, oddsSummary: null },
    derived: [],
    coverage: EMPTY_COVERAGE,
  };

  /*
   * A fixture from another provider has no ESPN id, and the deep view is
   * addressed by one — so it is found rather than looked up: the competition
   * names the league, the league's scoreboard for that day names the events, and
   * the fixture is matched to one of them by team names.
   *
   * Without this the timeline, the stats, the lineups, the momentum graph and
   * the shot map were blank for every fixture that arrived from TheSportsDB, the
   * OpenFootball archive or football-data.org — most of the board — and the
   * analysis panel told the reader deep data was "only available for fixtures
   * served by ESPN's public feed", which was never true.
   */
  let parsed = parseEspnId(input.externalId);
  if (!parsed) {
    const resolved = await resolveEspnEventId({
      externalId: input.externalId,
      homeTeam: input.homeTeam,
      awayTeam: input.awayTeam,
      competition: input.competition ?? null,
      competitionId: input.competitionId ?? null,
      kickoff: input.kickoff ?? null,
      sport: input.sport,
    }).catch(() => null);
    parsed = resolved ? parseEspnId(resolved) : null;
  }
  if (!parsed) {
    return {
      ...base,
      note: "This fixture is not on the free feed that carries live commentary and stats, so we show what we measured ourselves.",
    };
  }

  const live = input.status === "LIVE" || input.status === "HT";
  const finished = input.status === "FT";
  const ttl = live ? TTL_LIVE : finished ? TTL_FINISHED : TTL_PRE;
  // Keyed on the resolved ESPN event, so a fixture reached by name-matching
  // shares its cache entry with the same fixture reached by id.
  const cacheKey = `sports:detail:${parsed.league}:${parsed.eventId}`;

  if (!input.fresh) {
    const cached = await cacheGet<MatchDetail>(cacheKey).catch(() => null);
    if (cached) return { ...cached, status: input.status ?? cached.status };
  }

  const summary = await fetchSummary(parsed.league, parsed.eventId, input.sport ?? "soccer");
  if (!summary) {
    return { ...base, note: "The provider did not answer for this fixture. Try again in a moment." };
  }

  const events = arr(summary.keyEvents)
    .map(normalizeEvent)
    .filter((e): e is MatchEvent => e !== null);

  const stats = normalizeTeamStats(obj(summary.boxscore));
  const lineups = normalizeLineups(arr(summary.rosters), input.homeTeam, input.awayTeam);
  const commentary = normalizeCommentary(arr(summary.commentary));

  // Momentum prefers the play-by-play (it carries every attempt) and falls back
  // to the key events (goals and cards only) so a fixture with no commentary
  // still shows where the goals came from rather than an empty graph.
  const momentumSource =
    commentary.length > 0
      ? commentary.map((c) => ({ minute: parseMinute(c.minute), text: c.text }))
      : events.map((e) => ({ minute: e.minute, text: e.text }));
  const momentum = computeMomentum(momentumSource, input.homeTeam, input.awayTeam);

  const shots = events.filter((e) => e.position && (e.scoring || /goal|shot|attempt/i.test(e.text)));

  const series = arr(summary.seasonseries).map(obj)[0];
  const h2h = series
    ? {
        title: str(series.title) ?? `${input.homeTeam} vs ${input.awayTeam}`,
        summary: str(series.summary) ?? "",
        label: str(series.seriesLabel) ?? "Head-to-Head",
      }
    : null;

  const lastFive = arr(summary.lastFiveGames).map((raw) => {
    const row = obj(raw);
    const team = obj(row.team);
    return {
      team: str(team.displayName) ?? "",
      games: arr(row.events)
        .map((ev) => {
          const e = obj(ev);
          const gameResult = str(e.gameResult);
          return gameResult ? gameResult.toUpperCase() : null;
        })
        .filter((g): g is string => Boolean(g)),
    };
  });

  const gameInfo = obj(summary.gameInfo);
  const venue = obj(gameInfo.venue);
  const oddsRow = arr(summary.odds).map(obj)[0];
  const details = obj(oddsRow?.details ?? oddsRow);

  const detail: MatchDetail = {
    found: events.length > 0 || stats.length > 0 || lineups.length > 0,
    provider: input.provider,
    externalId: input.externalId,
    competition: input.competition ?? null,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    status: input.status ?? null,
    source: "espn-summary",
    sourceUrl: `https://www.espn.com/soccer/match/_/gameId/${parsed.eventId}`,
    events,
    stats,
    lineups,
    momentum,
    shots,
    commentary,
    insights: [],
    h2h,
    lastFive,
    info: {
      venue: str(venue.fullName),
      attendance: str(gameInfo.attendance) ?? null,
      oddsSummary: str(details.overUnder) != null ? `O/U ${details.overUnder}` : null,
    },
    derived: [
      ...(momentum.length > 0 ? ["momentum"] : []),
      ...(lineups.some((l) => l.starters.some((p) => p.rating != null)) ? ["connectPlusRating"] : []),
    ],
    coverage: {
      timeline: events.length > 0,
      teamStats: stats.length > 0,
      lineups: lineups.some((l) => l.starters.length > 0),
      perPlayerStats: lineups.some((l) => l.starters.some((p) => p.stats.length > 0)),
      momentum: momentum.length > 0,
      shotMap: shots.length > 0,
      h2h: Boolean(h2h),
      heatmaps: false,
      playerMarketValue: false,
      careerAnalytics: false,
    },
  };

  // The written read is derived last, from the finished detail, so it can never
  // describe a field that failed to load. An empty array is the honest answer for
  // a fixture with nothing measured behind it.
  detail.insights = buildInsights(detail);
  if (detail.insights.length > 0) detail.derived = [...detail.derived, "insights"];

  // Cache even the sparse answer: a fixture without a timeline will not grow one,
  // and re-asking on every poll is what burns the free egress budget.
  await cacheSet(cacheKey, detail, ttl).catch(() => {});

  return detail;
}
