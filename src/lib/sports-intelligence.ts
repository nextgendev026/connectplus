import { prisma } from "@/lib/prisma";
import { getFixtureContext, type H2HMeeting, type TeamForm } from "@/lib/sports-h2h";
import { applyDirectives, extractDirectives, type StoredDirective } from "@/lib/mind-directives";
import { createLogger } from "@/lib/logger";
import {
  competitionRelevance,
  getSportsHub,
  LIVE_STATUSES,
  type NormalizedMatch,
} from "@/lib/sports";

/**
 * Sports intelligence.
 *
 * Two jobs, both owned here so the public page stays read-only:
 *
 *   1. TEACH the hive mind — every fixture, scoreline and eventual result is
 *      folded into NeuralMemory (source "sports") with competition/team tags,
 *      so trends like "low-scoring derbies" or "Gor Mahia's away form" become
 *      recallable signals the rest of the platform can learn from.
 *
 *   2. PREDICT and GRADE — a transparent Poisson model turns those signals plus
 *      current odds into picks across FOUR markets (1X2, over/under 2.5, both
 *      teams to score, correct score), each with a written rationale. Finished
 *      picks are graded per market so accuracy is a real number, broken down
 *      and calibratable, that the next prediction can use as a prior.
 *
 * Nothing here calls an AI provider: picks must be reproducible and cheap, and
 * a hallucinated "lock" is worse than an honest 52% lean.
 */

const log = createLogger("sports-intelligence");

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving nothing about
 * order — callers use it for side-effect writes, not for building a result.
 * Exported so the batching contract is unit-testable.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  const size = Math.max(1, Math.min(Math.trunc(limit) || 1, items.length || 1));
  let cursor = 0;
  const workers = Array.from({ length: size }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
}

export const MARKETS = ["1X2", "over-under", "btts", "correct-score"] as const;
export type MarketKey = (typeof MARKETS)[number];

/** The strategy the hub publishes. */
export const PRIMARY_MODEL = "hive-hybrid";
/**
 * The honest benchmark: a pick that simply follows the de-vigged closing odds.
 * It gets no model input at all, so comparing the two answers the only question
 * that matters — does the model beat the line?
 */
export const BASELINE_MODEL = "market-baseline";

export const MARKET_LABELS: Record<string, string> = {
  "1X2": "Match result",
  "over-under": "Total goals",
  btts: "Both teams to score",
  "correct-score": "Correct score",
};

export interface MarketPrediction {
  market: MarketKey;
  selection: string;
  confidence: number;
  homeWinPct: number | null;
  drawPct: number | null;
  awayWinPct: number | null;
  expectedHomeGoals: number | null;
  expectedAwayGoals: number | null;
  valueEdge: number | null;
  rationale: string;
}

/** Deterministic team-strength proxy in [0,1] when no table/form data exists. */
function teamStrength(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function poisson(k: number, lambda: number): number {
  let fact = 1;
  for (let i = 2; i <= k; i++) fact *= i;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / fact;
}

const MAX_GOALS = 8;

export interface PredictionPrior {
  /** Accuracy of past settled picks in this competition, 0..1. */
  competitionAccuracy: number | null;
  settledSample: number;
  /** Per-market accuracy, used to temper confidence in weaker markets. */
  marketAccuracy?: Record<string, { accuracy: number; sample: number }>;
}

interface PoissonGrid {
  matrix: number[][];
  lambdaHome: number;
  lambdaAway: number;
  pHome: number;
  pDraw: number;
  pAway: number;
  pOver25: number;
  pBtts: number;
  implied: { home: number; draw: number; away: number } | null;
}

function exactScoreProb(matrix: number[][], h: number, a: number): number {
  return matrix[h]?.[a] ?? 0;
}

/** Shared Poisson grid so every market is derived from one consistent model. */
/**
 * League-average goals per side, and the floor on how many real matches it takes
 * before form is trusted at all.
 */
const LEAGUE_HOME_GOALS = 1.45;
const LEAGUE_AWAY_GOALS = 1.15;
/**
 * Minimum mind weight once an operator directive applies. A human instruction is
 * the most authoritative signal available to us, so it must not be diluted to
 * nothing by an absence of learned lessons for that fixture.
 */
const DIRECTIVE_HEAT_FLOOR = 0.85;
const MIN_FORM_SAMPLE = 3;
/** Sample size at which real form fully replaces the base estimate. */
const FULL_FORM_SAMPLE = 5;

export interface FormSignal {
  home: TeamForm | null;
  away: TeamForm | null;
  h2h: H2HMeeting[];
}

/**
 * Expected goals for one side from real scored/conceded rates.
 *
 * The classic strength model: a side's attack rate multiplies the opponent's
 * defence rate around the league baseline. Returns null when there is not
 * enough real evidence, so the caller can keep the base estimate rather than
 * fold in a number built on one match.
 */
function realExpectation(attack: TeamForm | null, defence: TeamForm | null, venue: "home" | "away"): number | null {
  const base = venue === "home" ? LEAGUE_HOME_GOALS : LEAGUE_AWAY_GOALS;
  const attackRate = attack?.avgGoalsFor != null ? attack.avgGoalsFor / base : null;
  const defenceRate = defence?.avgGoalsAgainst != null ? defence.avgGoalsAgainst / base : null;
  // One side of the pair is enough to be useful; requiring both would discard
  // real information just because the opponent's history is thin.
  if (attackRate == null && defenceRate == null) return null;
  const expected = base * (attackRate ?? 1) * (defenceRate ?? 1);
  return Math.min(Math.max(expected, 0.2), 4.2);
}

function buildGrid(
  match: NormalizedMatch,
  mind?: MindSignal | null,
  form?: FormSignal | null
): PoissonGrid {
  const homeStrength = teamStrength(match.homeTeam);
  const awayStrength = teamStrength(match.awayTeam);

  let lambdaHome = 1.35 + 0.9 * homeStrength - 0.5 * awayStrength + 0.25;
  let lambdaAway = 1.05 + 0.9 * awayStrength - 0.5 * homeStrength;

  // ── Real form ─────────────────────────────────────────────────────────────
  // The base estimate above is seeded by a hash of the team NAME, which is
  // deterministic but carries no football information at all. When real recent
  // results exist they replace it, weighted by how much evidence there is:
  // three matches is the floor for being trusted at all, five replaces it
  // outright. Below the floor the estimate is left untouched rather than
  // nudged, because half a match of signal is worse than none.
  if (form) {
    const samples = Math.min(form.home?.played ?? 0, form.away?.played ?? 0);
    if (samples >= MIN_FORM_SAMPLE) {
      const weight = Math.min(samples, FULL_FORM_SAMPLE) / FULL_FORM_SAMPLE;
      const homeReal = realExpectation(form.home, form.away, "home");
      const awayReal = realExpectation(form.away, form.home, "away");
      if (homeReal != null) lambdaHome = lambdaHome * (1 - weight) + homeReal * weight;
      if (awayReal != null) lambdaAway = lambdaAway * (1 - weight) + awayReal * weight;
    }

    // Head-to-head: these two sides' actual meetings are a better guide to the
    // shape of this fixture than either side's general form. Kept deliberately
    // gentle — a couple of meetings is a hint, not a season.
    if (form.h2h.length >= 2) {
      const totals = form.h2h
        .map((m) => (m.homeScore ?? 0) + (m.awayScore ?? 0))
        .filter((t) => t > 0);
      if (totals.length >= 2) {
        const avgTotal = totals.reduce((sum, t) => sum + t, 0) / totals.length;
        const scale = 1 + ((avgTotal - 2.6) / 2.6) * 0.12;
        lambdaHome *= scale;
        lambdaAway *= scale;
      }
    }
  }

  // ── Combined-mind adjustment ──────────────────────────────────────────────
  // The hive's own lessons shift the goal expectations BEFORE the grid is built,
  // so all four markets stay derived from one consistent scoreline distribution.
  // Weight is proportional to `heat` — how much learned evidence actually exists
  // for these two teams — which means a fixture with no history is untouched by
  // the mind and remains an honest base-model call.
  if (mind && mind.heat > 0) {
    const lean = (mind.momentum.home - 0.5) * 0.5 * mind.heat;
    lambdaHome *= 1 + lean;
    lambdaAway *= 1 - lean;
    if (mind.avgGoals != null) {
      const goalsScale = 1 + ((mind.avgGoals - 2.6) / 2.6) * 0.25 * mind.heat;
      lambdaHome *= goalsScale;
      lambdaAway *= goalsScale;
    }
  }

  lambdaHome = Math.min(Math.max(lambdaHome, 0.3), 3.6);
  lambdaAway = Math.min(Math.max(lambdaAway, 0.25), 3.6);

  const matrix: number[][] = [];
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let pOver25 = 0;
  let pBtts = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    matrix[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poisson(h, lambdaHome) * poisson(a, lambdaAway);
      matrix[h]![a] = p;
      if (h > a) pHome += p;
      else if (h === a) pDraw += p;
      else pAway += p;
      if (h + a >= 3) pOver25 += p;
      if (h >= 1 && a >= 1) pBtts += p;
    }
  }

  // Market blend. Bookmaker odds carry information our name-hash cannot, but
  // they also carry margin, so we de-vig before mixing.
  let implied: PoissonGrid["implied"] = null;
  if (match.oddsHome && match.oddsDraw && match.oddsAway) {
    const rawHome = 1 / match.oddsHome;
    const rawDraw = 1 / match.oddsDraw;
    const rawAway = 1 / match.oddsAway;
    const overround = rawHome + rawDraw + rawAway;
    if (overround > 0) {
      implied = { home: rawHome / overround, draw: rawDraw / overround, away: rawAway / overround };
      pHome = 0.6 * pHome + 0.4 * implied.home;
      pDraw = 0.6 * pDraw + 0.4 * implied.draw;
      pAway = 0.6 * pAway + 0.4 * implied.away;
    }
  }

  const total = pHome + pDraw + pAway || 1;
  return {
    matrix,
    lambdaHome,
    lambdaAway,
    pHome: pHome / total,
    pDraw: pDraw / total,
    pAway: pAway / total,
    pOver25,
    pBtts,
    implied,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/* ------------------------------------------------------------------ */
/* Combined mind                                                       */
/* ------------------------------------------------------------------ */

/**
 * What the platform's combined mind knows about a fixture.
 *
 * Derived from the hive's own NeuralMemory corpus — result lessons written when
 * picks settled and competition trends written by the learner — and deliberately
 * PURE so the arithmetic is unit-testable and cannot silently invent evidence.
 */
export interface MindSignal {
  /** 0..1: how much learned evidence backs this fixture. 0 = base model only. */
  heat: number;
  /** How often the home side won in comparable lessons. 0.5 = no opinion. */
  momentum: { home: number; away: number };
  /** Goals per game the mind associates with this competition, if it has learned any. */
  avgGoals: number | null;
  lessons: number;
  notes: string[];
}

/** One memory row, as far as the mind's sports reader cares. */
export interface MindMemory {
  source: string;
  category: string;
  content: string;
  tags: string | null;
  metadata: string | null;
  confidence: number;
}

const NEUTRAL_MIND: MindSignal = {
  heat: 0,
  momentum: { home: 0.5, away: 0.5 },
  avgGoals: null,
  lessons: 0,
  notes: [],
};

/** Below this many lessons the mind has no business moving a prediction. */
export const MIND_MIN_LESSONS = 3;
/** Lessons needed before the mind speaks with full weight. */
export const MIND_FULL_HEAT_LESSONS = 8;

function slugName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
}

/**
 * Memory tags are written space-separated (`gor mahia`), team names arrive with
 * punctuation (`Gor Mahia FC`), so compare on a squashed form of both sides.
 * Without this, a lesson about "Gor Mahia" never matched its own tag and the
 * mind silently had no opinion — the bug it caused was invisible in production.
 */
function tagHaystack(tags: string): string {
  return tags.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tagIncludes(tags: string, value: string): boolean {
  const needle = slugName(value);
  return needle.length >= 4 && tagHaystack(tags).includes(needle);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Fold the hive's sports memories into one signal for a fixture.
 *
 * Matching is on the same slugged tags the learner writes, so "Gor Mahia" and
 * "gor-mahia" hit the same lessons, and only lessons that actually name both
 * teams are allowed to vote on the momentum.
 */
export function consultMind(corpus: MindMemory[], match: NormalizedMatch): MindSignal {
  if (corpus.length === 0) return NEUTRAL_MIND;

  const scoreline = new RegExp(
    `${escapeRegExp(match.homeTeam)}\\s+(\\d+)\\s*-\\s*(\\d+)\\s+${escapeRegExp(match.awayTeam)}`,
    "i"
  );

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let lessonCount = 0;
  let competitionGoals = 0;
  let competitionGames = 0;

  for (const memory of corpus) {
    if (memory.source !== "sports") continue;
    const tags = (memory.tags ?? "").toLowerCase();
    const text = memory.content ?? "";
    const lower = text.toLowerCase();

    if (memory.category === "wisdom" && lower.startsWith("result lesson:")) {
      // A lesson only counts when it names BOTH teams of this fixture.
      if (!tagIncludes(tags, match.homeTeam) || !tagIncludes(tags, match.awayTeam)) continue;
      const parsed = scoreline.exec(text);
      if (!parsed) continue;
      lessonCount++;
      const home = Number(parsed[1]);
      const away = Number(parsed[2]);
      if (home > away) homeWins++;
      else if (away > home) awayWins++;
      else draws++;
      continue;
    }

    if (memory.category === "trend" && tagIncludes(tags, match.competition)) {
      try {
        const meta = JSON.parse(memory.metadata ?? "{}") as { goals?: number; finished?: number };
        if (typeof meta.goals === "number" && typeof meta.finished === "number" && meta.finished > 0) {
          competitionGoals += meta.goals;
          competitionGames += meta.finished;
        }
      } catch {
        /* a malformed trend must not break a prediction */
      }
    }
  }

  const heat = Math.min(1, lessonCount / MIND_FULL_HEAT_LESSONS);
  const avgGoals = competitionGames > 0 ? competitionGoals / competitionGames : null;
  const notes: string[] = [];

  let signal: MindSignal;
  if (lessonCount >= MIND_MIN_LESSONS) {
    const homeRate = homeWins / lessonCount;
    notes.push(
      `Hive mind: ${lessonCount} comparable lessons (home ${homeWins}-draw ${draws}-away ${awayWins}) weight the model ${Math.round(heat * 100)}%.`
    );
    if (avgGoals != null) {
      notes.push(`Learned scoring in ${match.competition}: ${avgGoals.toFixed(2)} goals/game.`);
    }
    signal = { heat, momentum: { home: homeRate, away: 1 - homeRate }, avgGoals, lessons: lessonCount, notes };
  } else if (avgGoals != null) {
    notes.push(`Learned scoring in ${match.competition}: ${avgGoals.toFixed(2)} goals/game.`);
    signal = { heat: Math.min(0.4, heat), momentum: { home: 0.5, away: 0.5 }, avgGoals, lessons: lessonCount, notes };
  } else {
    signal = { ...NEUTRAL_MIND, lessons: lessonCount, notes };
  }

  // Operator directives ride the same channel as learned evidence, but are not
  // gated by `heat`: they are an explicit instruction, not an inference, so a
  // fixture with no lessons at all still honours them.
  return withDirectives(signal, extractDirectives(corpus), match);
}

/**
 * Fold operator instructions into a mind signal.
 *
 * The directive's lean is merged into the momentum the grid already consumes and
 * its goal shift adjusts the competition scoring rate, so all four markets stay
 * derived from one scoreline distribution. `heat` is floored so the instruction
 * is actually felt in `buildGrid`, and every applied directive is named in the
 * notes — a reader can always see that a human, not the model, moved the pick.
 */
function withDirectives(base: MindSignal, directives: StoredDirective[], match: NormalizedMatch): MindSignal {
  const effect = applyDirectives(directives, match);
  if (effect.applied.length === 0) return base;

  const home = clamp(base.momentum.home + effect.homeLean, 0.02, 0.98);
  const avgGoals =
    effect.goalsBias !== 0
      ? Math.max(0.4, (base.avgGoals ?? LEAGUE_HOME_GOALS + LEAGUE_AWAY_GOALS) + effect.goalsBias)
      : base.avgGoals;

  return {
    heat: Math.max(base.heat, DIRECTIVE_HEAT_FLOOR),
    momentum: { home, away: clamp(base.momentum.away - effect.homeLean, 0.02, 0.98) },
    avgGoals,
    lessons: base.lessons,
    notes: [...base.notes, ...effect.notes],
  };
}

/**
 * Load the sports slice of the mind once per run — never once per fixture.
 *
 * Operator directives are read in the same pass: they are few, they are consulted
 * per fixture, and a second query would double the round trips for no gain.
 */
export async function loadMindCorpus(limit = 400): Promise<MindMemory[]> {
  return prisma.neuralMemory
    .findMany({
      where: { source: { in: ["sports", "operator"] } },
      select: { source: true, category: true, content: true, tags: true, metadata: true, confidence: true },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 20), 1000),
    })
    .catch(() => [] as MindMemory[]);
}

function priorBlurb(prior: PredictionPrior, competition: string): string {
  if (prior.competitionAccuracy != null && prior.settledSample >= 5) {
    return `Hive prior: ${(prior.competitionAccuracy * 100).toFixed(0)}% accuracy across ${prior.settledSample} settled ${competition} picks.`;
  }
  return `Hive prior: not enough settled ${competition} picks yet, leaning on the base model.`;
}

/**
 * Describe the real-form input behind a pick.
 *
 * The rationale is the model's own audit trail, so a pick built on real results
 * has to be visibly distinguishable from one that fell back to the base
 * estimate — otherwise there is no way to tell why two similar fixtures got
 * different numbers, and no way to spot the form feed going quiet.
 */
function describeForm(form?: FormSignal | null): string {
  if (!form) return "";
  const parts: string[] = [];
  if (form.home && form.home.played >= MIN_FORM_SAMPLE) parts.push(`${form.home.team} ${form.home.form}`);
  if (form.away && form.away.played >= MIN_FORM_SAMPLE) parts.push(`${form.away.team} ${form.away.form}`);
  if (parts.length === 0) return "";
  const h2h =
    form.h2h.length > 0
      ? ` ${form.h2h.length} recent head-to-head meeting${form.h2h.length === 1 ? "" : "s"} factored in.`
      : "";
  return ` Real form: ${parts.join(", ")}.${h2h}`;
}

/** Temper confidence with the market's own historical hit rate. */
function applyMarketPrior(confidence: number, market: MarketKey, prior: PredictionPrior): number {
  const stats = prior.marketAccuracy?.[market];
  if (!stats || stats.sample < 8) return confidence;
  return confidence + (stats.accuracy - 0.5) * 0.06;
}

/**
 * Pure multi-market prediction core — exported so it can be unit-tested without
 * a database. Every market is derived from one Poisson grid, so the picks are
 * mutually consistent (an "Over 2.5" lean and a "0-0" correct score can never
 * both be the headline).
 */
export function predictMarkets(
  match: NormalizedMatch,
  prior: PredictionPrior,
  mind?: MindSignal | null,
  form?: FormSignal | null
): MarketPrediction[] {
  const grid = buildGrid(match, mind, form);
  const base = {
    homeWinPct: Math.round(grid.pHome * 1000) / 10,
    drawPct: Math.round(grid.pDraw * 1000) / 10,
    awayWinPct: Math.round(grid.pAway * 1000) / 10,
    expectedHomeGoals: Math.round(grid.lambdaHome * 100) / 100,
    expectedAwayGoals: Math.round(grid.lambdaAway * 100) / 100,
  };
  const xgLine = `Poisson model: xG ${grid.lambdaHome.toFixed(2)}–${grid.lambdaAway.toFixed(2)}.`;
  const priorLine = priorBlurb(prior, match.competition);
  const mindLine = mind && mind.notes.length > 0 ? ` ${mind.notes.join(" ")}` : "";
  const formLine = describeForm(form);
  const picks: MarketPrediction[] = [];

  // ── 1X2 ────────────────────────────────────────────────────────────────────
  const outcomes = [
    { key: "home" as const, label: `${match.homeTeam} win`, p: grid.pHome },
    { key: "draw" as const, label: "Draw", p: grid.pDraw },
    { key: "away" as const, label: `${match.awayTeam} win`, p: grid.pAway },
  ].sort((a, b) => b.p - a.p);
  const best = outcomes[0]!;
  let valueEdge: number | null = null;
  if (grid.implied && best.key !== "draw") {
    valueEdge = Math.round((best.p - grid.implied[best.key]) * 1000) / 10;
  }
  const edgeLine =
    valueEdge == null
      ? "No published odds to price an edge against."
      : valueEdge > 0
        ? `Model is ${valueEdge.toFixed(1)}pp above the market's implied price.`
        : `Market is ${Math.abs(valueEdge).toFixed(1)}pp shorter than the model — thin value.`;
  picks.push({
    market: "1X2",
    selection: best.label,
    confidence: clamp(applyMarketPrior(best.p, "1X2", prior), 0.34, 0.9),
    ...base,
    valueEdge,
    rationale: `${xgLine} ${best.label} carries the highest modelled probability (${(best.p * 100).toFixed(0)}%). ${edgeLine} ${priorLine}${formLine}${mindLine}`,
  });

  // ── Over / under 2.5 ───────────────────────────────────────────────────────
  const pUnder = 1 - grid.pOver25;
  const overLean = grid.pOver25 >= pUnder;
  const ouSelection = overLean ? "Over 2.5 goals" : "Under 2.5 goals";
  const ouP = overLean ? grid.pOver25 : pUnder;
  picks.push({
    market: "over-under",
    selection: ouSelection,
    confidence: clamp(applyMarketPrior(ouP, "over-under", prior), 0.4, 0.85),
    homeWinPct: null,
    drawPct: null,
    awayWinPct: null,
    expectedHomeGoals: base.expectedHomeGoals,
    expectedAwayGoals: base.expectedAwayGoals,
    valueEdge: null,
    rationale: `${xgLine} Total expected goals ${(grid.lambdaHome + grid.lambdaAway).toFixed(2)}, so ${ouSelection.toLowerCase()} is the lean (${(ouP * 100).toFixed(0)}%).`,
  });

  // ── Both teams to score ────────────────────────────────────────────────────
  const bttsYes = grid.pBtts >= 0.5;
  const bttsP = bttsYes ? grid.pBtts : 1 - grid.pBtts;
  picks.push({
    market: "btts",
    selection: bttsYes ? "Both teams to score" : "Not both teams to score",
    confidence: clamp(applyMarketPrior(bttsP, "btts", prior), 0.4, 0.85),
    homeWinPct: null,
    drawPct: null,
    awayWinPct: null,
    expectedHomeGoals: base.expectedHomeGoals,
    expectedAwayGoals: base.expectedAwayGoals,
    valueEdge: null,
    rationale: `${xgLine} Modelled chance both sides score: ${(grid.pBtts * 100).toFixed(0)}%, so the lean is ${bttsYes ? "yes" : "no"} (${(bttsP * 100).toFixed(0)}%).`,
  });

  // ── Correct score (headline scoreline) ─────────────────────────────────────
  let topH = 0;
  let topA = 0;
  let topP = -1;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      const p = exactScoreProb(grid.matrix, h, a);
      if (p > topP) {
        topP = p;
        topH = h;
        topA = a;
      }
    }
  }
  picks.push({
    market: "correct-score",
    selection: `${topH}-${topA}`,
    confidence: clamp(applyMarketPrior(topP, "correct-score", prior), 0.08, 0.4),
    homeWinPct: null,
    drawPct: null,
    awayWinPct: null,
    expectedHomeGoals: base.expectedHomeGoals,
    expectedAwayGoals: base.expectedAwayGoals,
    valueEdge: null,
    rationale: `${xgLine} Most likely exact scoreline is ${topH}-${topA} (${(topP * 100).toFixed(1)}%) — a low-conviction market by nature.`,
  });

  return picks;
}

/**
 * Grade a pick against a final score. Pure + exported so the settlement rules
 * for every market are unit-tested. Returns null when the score is incomplete.
 */
export function gradePick(
  market: string,
  selection: string,
  homeScore: number | null,
  awayScore: number | null,
  teams?: { home: string; away: string }
): boolean | null {
  if (homeScore == null || awayScore == null) return null;
  const total = homeScore + awayScore;

  if (market === "1X2" || market === "double-chance") {
    if (selection === "Draw") return homeScore === awayScore;
    if (!teams || !selection.endsWith(" win")) return null;
    // The model emits "<homeTeam> win" / "<awayTeam> win"; anything else is
    // stale and must not be graded as a win.
    if (selection === `${teams.home} win`) return homeScore > awayScore;
    if (selection === `${teams.away} win`) return awayScore > homeScore;
    return null;
  }

  if (market === "over-under") {
    if (/^over/i.test(selection)) return total > 2.5;
    if (/^under/i.test(selection)) return total < 2.5;
    return null;
  }

  if (market === "btts") {
    const yes = homeScore > 0 && awayScore > 0;
    if (/not both/i.test(selection)) return !yes;
    if (/both teams to score/i.test(selection)) return yes;
    return null;
  }

  if (market === "correct-score") {
    return selection === `${homeScore}-${awayScore}`;
  }

  return null;
}

/**
 * The market baseline: pick whichever outcome the closing prices make most
 * likely, with confidence equal to its de-vigged implied probability. Purely a
 * function of the odds — no Poisson grid, no priors, no learning.
 */
export function buildBaselinePick(match: NormalizedMatch): MarketPrediction | null {
  const { oddsHome, oddsDraw, oddsAway } = match;
  if (!oddsHome || !oddsDraw || !oddsAway) return null;
  const raw = { home: 1 / oddsHome, draw: 1 / oddsDraw, away: 1 / oddsAway };
  const overround = raw.home + raw.draw + raw.away;
  if (!(overround > 0)) return null;

  const implied = { home: raw.home / overround, draw: raw.draw / overround, away: raw.away / overround };
  const options = [
    { key: "home" as const, selection: `${match.homeTeam} win`, p: implied.home },
    { key: "draw" as const, selection: "Draw", p: implied.draw },
    { key: "away" as const, selection: `${match.awayTeam} win`, p: implied.away },
  ].sort((a, b) => b.p - a.p);
  const best = options[0];
  if (!best) return null;

  return {
    market: "1X2",
    selection: best.selection,
    confidence: best.p,
    homeWinPct: Math.round(implied.home * 1000) / 10,
    drawPct: Math.round(implied.draw * 1000) / 10,
    awayWinPct: Math.round(implied.away * 1000) / 10,
    expectedHomeGoals: null,
    expectedAwayGoals: null,
    valueEdge: 0,
    rationale: `Market baseline: follows the closing prices (${oddsHome.toFixed(2)} / ${oddsDraw.toFixed(2)} / ${oddsAway.toFixed(2)}). This is the line to beat, not a model view.`,
  };
}

async function competitionPrior(
  competition: string,
  marketAccuracy?: Record<string, { accuracy: number; sample: number }>
): Promise<PredictionPrior> {
  try {
    const rows = await prisma.sportsPrediction.findMany({
      where: { status: { in: ["WON", "LOST"] }, model: PRIMARY_MODEL, match: { competition } },
      select: { status: true },
      take: 200,
    });
    if (rows.length === 0) {
      return { competitionAccuracy: null, settledSample: 0, marketAccuracy };
    }
    const won = rows.filter((r) => r.status === "WON").length;
    return { competitionAccuracy: won / rows.length, settledSample: rows.length, marketAccuracy };
  } catch {
    return { competitionAccuracy: null, settledSample: 0, marketAccuracy };
  }
}

/** Per-market hit rates across all settled picks, used to temper confidence. */
export async function marketAccuracy(): Promise<Record<string, { accuracy: number; sample: number }>> {
  try {
    const rows = await prisma.sportsPrediction.groupBy({
      by: ["market", "status"],
      where: { status: { in: ["WON", "LOST"] }, model: PRIMARY_MODEL },
      _count: { _all: true },
    });
    const acc: Record<string, { won: number; total: number }> = {};
    for (const row of rows) {
      const entry = (acc[row.market] ??= { won: 0, total: 0 });
      entry.total += row._count._all;
      if (row.status === "WON") entry.won += row._count._all;
    }
    return Object.fromEntries(
      Object.entries(acc).map(([market, e]) => [
        market,
        { accuracy: e.total > 0 ? e.won / e.total : 0.5, sample: e.total },
      ])
    );
  } catch {
    return {};
  }
}

/**
 * Fold a batch of fixtures into neural memory. Deduped per (day, competition)
 * so a 30-second poll does not spam the mind with the same rows.
 */
export async function teachRealResults(matches: NormalizedMatch[]): Promise<number> {
  /**
   * Learn from every finished match we actually observed.
   *
   * The only result lessons used to be written when one of OUR OWN picks
   * settled. That is a closed loop: the mind could only ever learn from
   * fixtures it had already predicted, so it never saw a match it declined to
   * call and could not tell a league's real shape from its own coverage gaps.
   *
   * These lessons carry the observed scoreline for any completed fixture, which
   * is the same evidence `consultMind` counts as head-to-head momentum — so the
   * mind's opinion starts tracking real football instead of its own output.
   */
  const finished = matches.filter(
    (m) =>
      m.status === "FT" &&
      m.homeScore !== null &&
      m.awayScore !== null &&
      m.homeTeam &&
      m.awayTeam
  );
  if (finished.length === 0) return 0;

  const keys = [...new Set(finished.map((m) => `${m.provider}:${m.externalId}`))];
  // One bounded read decides create-vs-skip for the whole batch. Learning the
  // same match twice would double-count it as momentum evidence, which quietly
  // skews every prediction that later consults it.
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const slice = keys.slice(i, i + 200);
    const rows = await prisma.neuralMemory
      .findMany({
        where: { source: "sports", category: "wisdom", tags: { contains: "sport:real" } },
        select: { metadata: true },
        take: 5000,
      })
      .catch(() => [] as { metadata: string | null }[]);
    for (const row of rows) {
      try {
        const meta = JSON.parse(row.metadata ?? "{}") as { key?: string };
        if (meta.key && slice.includes(meta.key)) known.add(meta.key);
      } catch {
        /* a malformed row must not stop the batch */
      }
    }
    if (rows.length < 5000) break;
  }

  const lessons = finished
    .filter((m) => !known.has(`${m.provider}:${m.externalId}`))
    .slice(0, 500)
    .map((m) => {
      const key = `${m.provider}:${m.externalId}`;
      return {
        source: "sports",
        category: "wisdom",
        // The `Result lesson:` prefix and the `HOME h-a AWAY` shape are both
        // load-bearing: consultMind parses exactly this to count real results.
        content: `Result lesson: ${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} (${m.competition}).`,
        tags: `result,lesson,sport:real,sport:${m.sport},${m.competition.toLowerCase()},${m.homeTeam.toLowerCase()},${m.awayTeam.toLowerCase()}`,
        // An observed scoreline is a fact, not an opinion, so it carries more
        // weight than a pick that merely landed.
        confidence: 0.85,
        metadata: JSON.stringify({ key, competition: m.competition, sport: m.sport }),
      };
    });

  if (lessons.length === 0) return 0;
  const result = await prisma.neuralMemory.createMany({ data: lessons }).catch(() => ({ count: 0 }));
  return result.count;
}

export async function teachMind(matches: NormalizedMatch[]): Promise<number> {
  if (matches.length === 0) return 0;
  const day = new Date().toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  let created = 0;

  const byCompetition = new Map<string, NormalizedMatch[]>();
  for (const m of matches) {
    const list = byCompetition.get(m.competition) ?? [];
    list.push(m);
    byCompetition.set(m.competition, list);
  }

  // A merged board can carry 100+ competitions. Teaching the long tail every 30
  // minutes costs more than it returns, so a run teaches the ones this audience
  // actually follows (regional + big leagues first).
  const groups = [...byCompetition.entries()]
    .map(([competition, fixtures]) => ({
      competition,
      fixtures,
      relevance: competitionRelevance(competition, fixtures[0]?.country ?? null),
    }))
    .sort((a, b) => a.relevance - b.relevance || b.fixtures.length - a.fixtures.length)
    .slice(0, 40);

  // One read decides create-vs-update for every competition, replacing a
  // findFirst per competition (which alone was ~100 sequential round-trips).
  const todays = await prisma.neuralMemory
    .findMany({
      where: { source: "sports", category: "trend", createdAt: { gte: dayStart } },
      select: { id: true, tags: true },
    })
    .catch(() => [] as { id: string; tags: string | null }[]);
  const idByTag = new Map<string, string>();
  for (const row of todays) {
    const key = (row.tags ?? "").split(",")[0]?.trim();
    if (key) idByTag.set(key, row.id);
  }
  const toCreate: { tag: string; content: string; metadata: string }[] = [];
  const toUpdate: { id: string; content: string; metadata: string }[] = [];

  for (const { competition, fixtures } of groups) {
    const tag = `sport:${fixtures[0]?.sport ?? "football"}:${competition.toLowerCase()}`;

    const live = fixtures.filter((f) => LIVE_STATUSES.includes(f.status));
    const finished = fixtures.filter((f) => f.status === "FT");
    const lines = fixtures.slice(0, 12).map((f) => {
      if (f.status === "FT" || f.status === "LIVE" || f.status === "HT") {
        return `${f.homeTeam} ${f.homeScore ?? 0}-${f.awayScore ?? 0} ${f.awayTeam} (${f.status}${
          f.minute ? ` ${f.minute}'` : ""
        })`;
      }
      return `${f.homeTeam} vs ${f.awayTeam} — scheduled ${f.kickoff?.slice(11, 16) ?? "TBD"} UTC`;
    });

    const content = [
      `${competition} snapshot for ${day}: ${fixtures.length} fixtures, ${live.length} live, ${finished.length} finished.`,
      ...lines,
    ].join("\n");

    const metadata = JSON.stringify({
      day,
      competition,
      fixtures: fixtures.length,
      live: live.length,
      finished: finished.length,
      goals: finished.reduce((n, f) => n + (f.homeScore ?? 0) + (f.awayScore ?? 0), 0),
    });

    const existingId = idByTag.get(tag);
    if (existingId) toUpdate.push({ id: existingId, content, metadata });
    else toCreate.push({ tag, content, metadata });
  }

  if (toCreate.length > 0) {
    const result = await prisma.neuralMemory
      .createMany({
        data: toCreate.map((row) => ({
          source: "sports",
          category: "trend",
          content: row.content,
          tags: `${row.tag},sports,football,${row.tag.split(":").slice(2).join(":")}`,
          confidence: 0.6,
          metadata: row.metadata,
        })),
      })
      .catch(() => ({ count: 0 }));
    created += result.count;
  }

  // Updates carry different content per row, so they stay individual — but in
  // parallel, not one after another.
  await mapWithConcurrency(toUpdate, 8, async (row) => {
    await prisma.neuralMemory.update({ where: { id: row.id }, data: { content: row.content, metadata: row.metadata } }).catch(() => {});
  });

  return created;
}

export interface PredictRunResult {
  generated: number;
  refreshed: number;
  skipped: number;
  settled: number;
  taught: number;
  /** Picks built on real recent results rather than the base estimate. */
  formGrounded: number;
  /** Upstream form lookups this run actually opened. */
  formLookups: number;
  /** Real observed scorelines written into the combined mind's corpus. */
  realResultsTaught: number;
}

/**
 * Generate (or refresh) predictions across every market for each upcoming/live
 * fixture, and settle anything that has since finished.
 */
export async function runSportsIntelligence(opts: {
  matches?: NormalizedMatch[];
  limit?: number;
  teach?: boolean;
} = {}): Promise<PredictRunResult> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);

  let matches = opts.matches;
  if (!matches) {
    matches = (await getSportsHub({ fresh: true })).matches;
  }

  const timings: Record<string, number> = {};
  const phase = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const value = await fn();
    timings[name] = Date.now() - t0;
    return value;
  };

  const taught = opts.teach === false ? 0 : await phase("teach", () => teachMind(matches));
  // Real observed results are learned separately from our own picks, so the
  // corpus reflects actual football rather than only the fixtures we called.
  if (opts.teach !== false) {
    await phase("teachResults", async () => {
      realResultsTaught = await teachRealResults(matches).catch(() => 0);
    });
  }
  const settled = await phase("settle", () => settlePredictions());
  const marketAcc = await phase("marketAccuracy", () => marketAccuracy());
  // The mind's own corpus, read once: predictions below are blended with what
  // the hive has actually learned rather than with static assumptions.
  const corpus = await phase("mind", () => loadMindCorpus());

  await phase("persist", () => persistForPrediction(matches));

  // Every provider that fed this snapshot gets picks — the hub merges sources,
  // so looking only at matches[0] would silently starve the other feeds.
  const providers = [...new Set(matches.map((m) => m.provider))];
  const candidates = await prisma.sportsMatch
    .findMany({
      where: {
        ...(providers.length > 0 ? { provider: { in: providers } } : {}),
        status: { in: ["SCHEDULED", "LIVE", "HT"] },
      },
      include: { predictions: { select: { id: true, market: true, status: true, model: true } } },
      orderBy: { kickoff: "asc" },
      // Over-fetch, then rank in memory: relevance is a name heuristic Prisma
      // cannot express, and without it a per-run budget of 40 goes to whichever
      // obscure league happens to kick off first.
      take: Math.min(Math.max(limit * 4, limit), 400),
    })
    .catch(() => []);

  const stored = candidates
    .map((row) => ({
      row,
      live: LIVE_STATUSES.includes(row.status as "LIVE" | "HT") ? 0 : 1,
      relevance: competitionRelevance(row.competition, row.country),
    }))
    .sort(
      (a, b) =>
        a.live - b.live ||
        a.relevance - b.relevance ||
        (a.row.kickoff?.getTime() ?? 0) - (b.row.kickoff?.getTime() ?? 0)
    )
    .slice(0, limit)
    .map((entry) => entry.row);

  const byKey = new Map(matches.map((m) => [`${m.provider}:${m.externalId}`, m]));
  const counts = { generated: 0, refreshed: 0, skipped: 0 };
  let mindsConsulted = 0;
  let formGrounded = 0;
  let realResultsTaught = 0;

  /**
   * Real-form lookups are the one part of this job that hits an upstream API,
   * so they are budgeted rather than unbounded. The result is cached per team
   * pair for ten minutes, which means a matchday usually resolves each side
   * once — but a cold run over hundreds of fixtures would otherwise open
   * hundreds of requests and get the job rate-limited off the provider.
   * Fixtures past the budget fall back to the base model, which is what they
   * did before this existed, so the ceiling degrades rather than breaks.
   */
  const FORM_LOOKUP_BUDGET = Math.min(
    Math.max(Number(process.env.SPORTS_FORM_LOOKUPS_PER_RUN ?? 60) || 60, 0),
    400
  );
  const formCache = new Map<string, FormSignal | null>();
  let formLookups = 0;

  async function formFor(match: NormalizedMatch): Promise<FormSignal | null> {
    const key = `${match.homeTeam}|${match.awayTeam}`.toLowerCase();
    const hit = formCache.get(key);
    if (hit !== undefined) return hit;
    if (formLookups >= FORM_LOOKUP_BUDGET) {
      formCache.set(key, null);
      return null;
    }
    formLookups++;
    const context = await getFixtureContext({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeTeamId: match.homeTeamId ?? null,
      awayTeamId: match.awayTeamId ?? null,
    }).catch(() => null);
    // Only a context with real played matches counts as grounding; an empty
    // lookup would otherwise be reported to the admin as if it had data.
    const signal: FormSignal | null =
      context && (context.home?.played || context.away?.played)
        ? { home: context.home, away: context.away, h2h: context.h2h }
        : null;
    formCache.set(key, signal);
    return signal;
  }

  // Preload the learned prior for every competition in the batch, in parallel,
  // so the write loop never awaits a read (and never fetches the same prior
  // twice from two workers).
  const priorCache = new Map<string, PredictionPrior>();
  const competitions = [...new Set(stored.map((row) => row.competition))];
  await mapWithConcurrency(competitions, 6, async (competition) => {
    priorCache.set(competition, await competitionPrior(competition, marketAcc));
  });

  /**
   * One fixture's worth of writes.
   *
   * Bounded concurrency is what keeps this job inside a serverless budget: the
   * old loop awaited every pick one at a time (~500 round-trips on a matchday),
   * which is how a 30-minute job turned into a 110-second request. Pending picks
   * are refreshed in parallel and fresh ones go out in ONE createMany, with the
   * (matchId, market, model) unique index absorbing any concurrent run.
   */
  async function processMatch(row: (typeof stored)[number]): Promise<void> {
    const predicate = byKey.get(`${row.provider}:${row.externalId}`);
    if (!predicate) {
      counts.skipped++;
      return;
    }

    const prior =
      priorCache.get(row.competition) ??
      (await competitionPrior(row.competition, marketAcc));

    const mind = consultMind(corpus, predicate);
    if (mind.heat > 0) mindsConsulted++;
    const form = await formFor(predicate);
    if (form) formGrounded++;
    const planned: { prediction: MarketPrediction; model: string }[] = predictMarkets(
      predicate,
      prior,
      mind,
      form
    ).map((prediction) => ({ prediction, model: PRIMARY_MODEL }));
    const baseline = buildBaselinePick(predicate);
    if (baseline) planned.push({ prediction: baseline, model: BASELINE_MODEL });

    const statusOf = new Map(row.predictions.map((p) => [`${p.market}|${p.model}`, p.status]));
    // The preload already told us which picks exist, so a new pick never pays
    // for a probe UPDATE that would match nothing. Settled picks are simply not
    // in either list — that is how "never rewrite a graded pick" is enforced.
    const refreshable = planned.filter(({ prediction, model }) => statusOf.get(`${prediction.market}|${model}`) === "PENDING");
    const fresh = planned.filter(({ prediction, model }) => !statusOf.has(`${prediction.market}|${model}`));

    const writeData = (prediction: MarketPrediction) => ({
      selection: prediction.selection,
      confidence: Math.round(prediction.confidence * 1000) / 1000,
      homeWinPct: prediction.homeWinPct,
      drawPct: prediction.drawPct,
      awayWinPct: prediction.awayWinPct,
      expectedHomeGoals: prediction.expectedHomeGoals,
      expectedAwayGoals: prediction.expectedAwayGoals,
      valueEdge: prediction.valueEdge,
      rationale: prediction.rationale,
    });

    await mapWithConcurrency(refreshable, 4, async ({ prediction, model }) => {
      try {
        const updated = await prisma.sportsPrediction.updateMany({
          where: { matchId: row.id, market: prediction.market, model, status: "PENDING" },
          data: writeData(prediction),
        });
        if (updated.count > 0) counts.refreshed++;
      } catch (err) {
        log.warn("prediction refresh failed", { matchId: row.id, market: prediction.market, error: err });
        counts.skipped++;
      }
    });

    if (fresh.length === 0) return;

    try {
      const created = await prisma.sportsPrediction.createMany({
        data: fresh.map(({ prediction, model }) => ({
          matchId: row.id,
          market: prediction.market,
          model,
          ...writeData(prediction),
        })),
        skipDuplicates: true,
      });
      counts.generated += created.count;

      // Only the headline pick is taught to the hive: the other markets follow
      // mechanically from it, and flooding memory with them would drown the
      // corpus signal the hive actually learns from.
      const headline = fresh.find(({ prediction, model }) => model === PRIMARY_MODEL && prediction.market === "1X2");
      if (headline) {
        await prisma.neuralMemory
          .create({
            data: {
              source: "sports",
              category: "wisdom",
              content: `Pick: ${headline.prediction.selection} — ${row.homeTeam} vs ${row.awayTeam} (${row.competition}). ${headline.prediction.rationale}`,
              tags: `prediction,sport:${row.sport},${row.competition.toLowerCase()},${row.homeTeam.toLowerCase()},${row.awayTeam.toLowerCase()}`,
              confidence: headline.prediction.confidence,
              metadata: JSON.stringify({
                matchId: row.id,
                market: headline.prediction.market,
                edge: headline.prediction.valueEdge,
              }),
            },
          })
          .catch(() => {});
      }
    } catch (err) {
      log.warn("prediction batch failed", { matchId: row.id, error: err });
      counts.skipped++;
    }
  }

  const writeStartedAt = Date.now();
  await mapWithConcurrency(stored, 6, processMatch);
  timings.write = Date.now() - writeStartedAt;

  log.info("sports intelligence run", {
    taught,
    settled,
    generated: counts.generated,
    refreshed: counts.refreshed,
    skipped: counts.skipped,
    matches: stored.length,
    mind: { corpus: corpus.length, consulted: mindsConsulted },
    // How many picks were built on real results rather than the name-hash base,
    // and how many upstream lookups that cost. If `grounded` stays at 0 while
    // `lookups` climbs, the provider feed is quietly returning nothing.
    form: { grounded: formGrounded, lookups: formLookups, budget: FORM_LOOKUP_BUDGET },
    realResultsTaught,
    timings,
  });
  return {
    generated: counts.generated,
    refreshed: counts.refreshed,
    skipped: counts.skipped,
    settled,
    taught,
    formGrounded,
    formLookups,
    realResultsTaught,
  };
}

async function persistForPrediction(matches: NormalizedMatch[]): Promise<void> {
  // Bounded to two workers: the pooler allows 5 connections and the settlement
  // and prior reads in the same run need the rest. 40 rows at concurrency 2 is
  // plenty to keep fixtures current.
  await mapWithConcurrency(matches.slice(0, 40), 2, async (m) => {
    await prisma.sportsMatch
      .upsert({
        where: { provider_externalId: { provider: m.provider, externalId: m.externalId } },
        create: {
          externalId: m.externalId,
          provider: m.provider,
          sport: m.sport,
          competition: m.competition,
          competitionId: m.competitionId ?? null,
          country: m.country ?? null,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
          minute: m.minute,
          kickoff: m.kickoff ? new Date(m.kickoff) : null,
          venue: m.venue ?? null,
          oddsHome: m.oddsHome ?? null,
          oddsDraw: m.oddsDraw ?? null,
          oddsAway: m.oddsAway ?? null,
        },
        update: {
          homeScore: m.homeScore,
          awayScore: m.awayScore,
          status: m.status,
          minute: m.minute,
          lastSyncedAt: new Date(),
        },
      })
      .catch(() => null);
  });
}

/**
 * Grade every pending pick whose match has finished and write the lesson back
 * into memory. This is the feedback loop that lets the hive's prior improve.
 */
export async function settlePredictions(): Promise<number> {
  const pending = await prisma.sportsPrediction
    .findMany({
      where: { status: "PENDING", match: { status: "FT" } },
      include: {
        match: { select: { homeTeam: true, awayTeam: true, homeScore: true, awayScore: true, competition: true } },
      },
      take: 400,
    })
    .catch(() => []);

  const settledAt = new Date();
  const wonIds: string[] = [];
  const lostIds: string[] = [];
  const activities: {
    type: string;
    matchId: string;
    predictionId: string;
    metadata: string;
  }[] = [];
  const lessons: {
    source: string;
    category: string;
    content: string;
    tags: string;
    confidence: number;
    metadata: string;
  }[] = [];

  for (const pick of pending) {
    const { homeScore, awayScore, homeTeam, awayTeam, competition } = pick.match;
    const won = gradePick(pick.market, pick.selection, homeScore, awayScore, {
      home: homeTeam,
      away: awayTeam,
    });
    if (won == null) continue;

    (won ? wonIds : lostIds).push(pick.id);
    activities.push({
      type: "prediction_settled",
      matchId: pick.matchId,
      predictionId: pick.id,
      metadata: JSON.stringify({
        market: pick.market,
        selection: pick.selection,
        won,
        score: `${homeScore}-${awayScore}`,
      }),
    });

    // Only the model's own 1X2 lessons are written to memory — the market
    // baseline is a benchmark, not something the hive should learn from.
    if (pick.market === "1X2" && pick.model === PRIMARY_MODEL) {
      lessons.push({
        source: "sports",
        category: "wisdom",
        content: `Result lesson: ${pick.selection} ${won ? "landed" : "missed"} — ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} (${competition}). Modelled confidence was ${(pick.confidence * 100).toFixed(0)}%.`,
        tags: `result,lesson,sport:football,${competition.toLowerCase()},${homeTeam.toLowerCase()},${awayTeam.toLowerCase()}`,
        confidence: won ? 0.75 : 0.55,
        metadata: JSON.stringify({ predictionId: pick.id, won, confidence: pick.confidence }),
      });
    }
  }

  // Four statements instead of ~1,200 individual writes. Settlement is a bulk
  // state transition, so it must be expressed as bulk SQL — the row-by-row
  // version was the single slowest thing in the job.
  await Promise.all([
    wonIds.length > 0
      ? prisma.sportsPrediction
          .updateMany({ where: { id: { in: wonIds } }, data: { status: "WON", settledAt } })
          .catch(() => null)
      : null,
    lostIds.length > 0
      ? prisma.sportsPrediction
          .updateMany({ where: { id: { in: lostIds } }, data: { status: "LOST", settledAt } })
          .catch(() => null)
      : null,
    activities.length > 0 ? prisma.sportsActivity.createMany({ data: activities }).catch(() => null) : null,
    lessons.length > 0 ? prisma.neuralMemory.createMany({ data: lessons }).catch(() => null) : null,
  ]);

  return wonIds.length + lostIds.length;
}

/** Competition-level trend rows for the admin monitor. */
export async function sportsTrends(): Promise<
  { competition: string; matches: number; live: number; avgGoals: number }[]
> {
  const rows = await prisma.sportsMatch
    .findMany({
      where: { status: { in: ["FT", "LIVE", "HT"] } },
      select: { competition: true, homeScore: true, awayScore: true, status: true },
      take: 400,
    })
    .catch(() => []);

  const byComp = new Map<string, { matches: number; live: number; goals: number; scored: number }>();
  for (const r of rows) {
    const e = byComp.get(r.competition) ?? { matches: 0, live: 0, goals: 0, scored: 0 };
    e.matches++;
    if (LIVE_STATUSES.includes(r.status as "LIVE" | "HT")) e.live++;
    if (r.homeScore != null && r.awayScore != null) {
      e.goals += r.homeScore + r.awayScore;
      e.scored++;
    }
    byComp.set(r.competition, e);
  }

  return [...byComp.entries()]
    .map(([competition, e]) => ({
      competition,
      matches: e.matches,
      live: e.live,
      avgGoals: e.scored > 0 ? Math.round((e.goals / e.scored) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 12);
}
