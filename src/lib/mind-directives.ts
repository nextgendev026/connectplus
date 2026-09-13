import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("mind-directives");

/**
 * Operator directives — the admin's standing instructions to the combined mind.
 *
 * The admin console chat is a conversation: it answers questions and then
 * forgets. This module is what makes it *teach*. When the operator issues a
 * standing instruction ("favour home teams in La Liga", "avoid heavy scoring in
 * Serie A"), it is parsed into a bounded numeric nudge, stored as a memory, and
 * consulted on every prediction from then on.
 *
 * Two design rules keep this safe:
 *
 *  1. **Parsing is deliberately conservative.** A directive is only recognised
 *     when the sentence contains an explicit instruction verb AND resolves to a
 *     real numeric effect (or is explicitly prefixed `directive:` / `rule:`).
 *     Ordinary chat like "always a pleasure" therefore cannot silently bend the
 *     model.
 *  2. **The effect is bounded.** A directive can move momentum by at most 20
 *     points and expected goals by at most 0.8 — an operator can steer the
 *     model, never overwrite the evidence. Every applied directive is named in
 *     the published rationale, so a reader can always see why a pick shifted.
 */

/** Momentum shift a normal directive carries, in probability points. */
const BASE_LEAN = 0.12;
/** A directive reworded with emphasis ("strongly", "always") carries this. */
const EMPHATIC_LEAN = 0.18;
/** Hard ceiling on how far an operator can move the home/away split. */
export const MAX_DIRECTIVE_LEAN = 0.2;
/** Goal shift a scoring directive carries, and the hard ceiling. */
const BASE_GOALS_BIAS = 0.35;
export const MAX_DIRECTIVE_GOALS_BIAS = 0.8;

/** Which side of a fixture a directive's lean should be applied to. */
export type DirectiveTarget = "home" | "away" | "team" | null;

export interface DirectiveScope {
  /** Competition the instruction is limited to, or null for every fixture. */
  competition: string | null;
  /** Team the instruction is limited to, or null. */
  team: string | null;
}

export interface ParsedDirective {
  scope: DirectiveScope;
  target: DirectiveTarget;
  /** Signed momentum shift applied to the target side. */
  lean: number;
  /** Signed shift to expected total goals. */
  goalsBias: number;
  /** Human-readable restatement of the effect, shown in the rationale. */
  note: string;
  /** 0..1 — how sure the parser is that this was meant as an instruction. */
  confidence: number;
}

export interface StoredDirective extends ParsedDirective {
  id: string;
  raw: string;
  active: boolean;
  createdBy: string | null;
  createdAt: string;
}

/** One directive resolved against a specific fixture. */
export interface DirectiveEffect {
  /** Momentum shift toward the home side (negative moves toward away). */
  homeLean: number;
  goalsBias: number;
  applied: StoredDirective[];
  notes: string[];
}

const EMPTY_EFFECT: DirectiveEffect = { homeLean: 0, goalsBias: 0, applied: [], notes: [] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Verbs that mark a sentence as a standing instruction rather than a question. */
const INSTRUCTION_VERBS =
  /\b(always|never|favour|favor|trust|back|avoid|stop|ignore|bias|prefer|lean|remember that|from now on)\b/i;

/** Explicit prefixes let an operator force a directive through the guard. */
const EXPLICIT_PREFIX = /^\s*(?:directive|rule)\s*[:\-]\s*/i;

const NEGATIVE_VERBS = /\b(never|avoid|stop|ignore|don'?t|do not|discount)\b/i;
const EMPHASIS_WORDS = /\b(strongly|always|heavily|really|greatly)\b/i;

/**
 * Scope words that must never be mistaken for a competition or team name.
 * Without this, "favour home teams" would extract "home teams" as a club.
 */
const NON_NAMES = new Set([
  "home",
  "away",
  "home teams",
  "away teams",
  "home team",
  "away team",
  "draws",
  "draw",
  "goals",
  "over",
  "under",
  "both",
  "the",
  "a",
  "an",
  "this",
  "that",
  "it",
  "them",
  "us",
  "we",
  "you",
  "i",
  "matches",
  "fixtures",
  "games",
  "betting",
  "model",
  "mind",
  "league",
  "cup",
]);

function tidyName(value: string): string {
  return value
    .trim()
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

/** A captured name is only usable when it is a real proper noun, not a pronoun. */
function usableName(value: string): string | null {
  const name = tidyName(value);
  if (name.length < 3) return null;
  if (NON_NAMES.has(name.toLowerCase())) return null;
  // Must contain a letter and not be purely lowercase filler like "them".
  if (!/[a-z]/i.test(name)) return null;
  return name;
}

/**
 * Pull the competition out of an instruction.
 *
 * Anchored on "in / across / for <Proper Noun>" so the capture starts at a
 * capitalised word, which is what keeps "always in the mood" from becoming a
 * competition called "the mood".
 */
export function extractCompetition(text: string): string | null {
  const patterns = [
    /\b(?:in|across|for)\s+(?:the\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/,
    /\b([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})\s+(?:matches|fixtures|games|league)\b/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const name = usableName(match[1]);
      // "in Over" / "in Under" would otherwise hijack a goals instruction.
      if (name && !/^(over|under|both|home|away)\b/i.test(name)) return name;
    }
  }
  return null;
}

/** Pull the team out of an instruction, anchored on the instruction verb. */
export function extractTeam(text: string): string | null {
  const match =
    /\b(?:favour|favor|trust|back|avoid|stop|ignore|prefer|lean)\s+(?:towards?\s+|on\s+|for\s+)?([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/.exec(
      text
    );
  if (!match?.[1]) return null;
  const name = usableName(match[1]);
  if (!name) return null;
  // A trailing competition-like phrase ("Arsenal in La Liga") is not a team.
  return name.replace(/\s+(?:in|at|for|on)\b.*$/i, "").trim() || null;
}

/** Which side is the instruction about, when it names no club? */
export function extractTarget(text: string): DirectiveTarget {
  if (/\bhome\s*(?:teams?|sides?|advantage|wins?|wins|win)\b/i.test(text)) return "home";
  if (/\baway\s*(?:teams?|sides?|wins?|win)\b/i.test(text)) return "away";
  if (/\bhome\b/i.test(text)) return "home";
  if (/\baway\b/i.test(text)) return "away";
  return null;
}

/** Signed goal expectation shift from a scoring instruction, if any. */
export function extractGoalsBias(text: string): number {
  const sign = /\b(under|fewer|less|low[- ]scoring|tight|defensive|cagey|dour)\b/i.test(text)
    ? -1
    : /\b(over|more|high[- ]scoring|free[- ]scoring|attacking|goals?)\b/i.test(text)
      ? 1
      : 0;
  if (sign === 0) return 0;

  // An explicit line ("over 2.5") is a stronger statement than a general "more goals".
  const line = /\b(?:over|under)\s+(\d+(?:\.\d+)?)\b/i.exec(text);
  const magnitude = line ? BASE_GOALS_BIAS * 1.4 : BASE_GOALS_BIAS;
  return clamp(sign * magnitude, -MAX_DIRECTIVE_GOALS_BIAS, MAX_DIRECTIVE_GOALS_BIAS);
}

function describe(directive: Omit<ParsedDirective, "note" | "confidence">): string {
  const where = directive.scope.team
    ? `${directive.scope.team}${directive.scope.competition ? ` in ${directive.scope.competition}` : ""}`
    : directive.scope.competition
      ? directive.scope.competition
      : "all fixtures";

  const parts: string[] = [];
  if (directive.lean !== 0) {
    const side =
      directive.target === "home" ? "home sides" : directive.target === "away" ? "away sides" : directive.scope.team ?? "the named side";
    parts.push(`${directive.lean > 0 ? "favours" : "discounts"} ${side} by ${Math.round(Math.abs(directive.lean) * 100)} points`);
  }
  if (directive.goalsBias !== 0) {
    parts.push(`${directive.goalsBias > 0 ? "raises" : "lowers"} expected goals by ${Math.abs(directive.goalsBias).toFixed(2)}`);
  }
  return `Operator directive (${where}): ${parts.join(" and ")}.`;
}

/**
 * Parse an operator message into a standing instruction.
 *
 * Returns null when the message is ordinary conversation. That is the common
 * case — the chat is a chatbot first — so the guard is intentionally tight:
 * without an instruction verb, or with no resolvable numeric effect and no
 * explicit `directive:` prefix, the message is left alone.
 */
export function parseDirective(text: string): ParsedDirective | null {
  const raw = text.trim();
  if (raw.length < 8) return null;

  const explicit = EXPLICIT_PREFIX.test(raw);
  const body = raw.replace(EXPLICIT_PREFIX, "").trim();
  if (!explicit && !INSTRUCTION_VERBS.test(body)) return null;

  const competition = extractCompetition(body);
  const team = extractTeam(body);
  const target: DirectiveTarget = team ? "team" : extractTarget(body);
  const rawGoalsBias = extractGoalsBias(body);

  const sign = NEGATIVE_VERBS.test(body) ? -1 : 1;
  const magnitude = EMPHASIS_WORDS.test(body) ? EMPHATIC_LEAN : BASE_LEAN;
  // The instruction's polarity applies to the scoring direction too: "avoid high
  // scoring" means lower goals, and "stop going under 2.5" means more of them.
  // Reading the goal words alone would invert both.
  const goalsBias = clamp(sign * rawGoalsBias, -MAX_DIRECTIVE_GOALS_BIAS, MAX_DIRECTIVE_GOALS_BIAS);
  // A lean needs a side to lean on — a named club, or a home/away phrase. An
  // instruction that only talks about scoring carries no momentum shift at all.
  const lean = target === null ? 0 : clamp(sign * magnitude, -MAX_DIRECTIVE_LEAN, MAX_DIRECTIVE_LEAN);

  if (lean === 0 && goalsBias === 0 && !explicit) return null;

  const scope: DirectiveScope = { competition, team };
  const parsed: Omit<ParsedDirective, "note" | "confidence"> = { scope, target, lean, goalsBias };

  return {
    ...parsed,
    note: describe(parsed),
    confidence: explicit ? 0.95 : team && competition ? 0.85 : 0.7,
  };
}

/** Normalise a name for tolerant comparison across providers. */
const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Loose "is this name mentioned by that name" test, tolerant of provider suffixes. */
function nameMatches(candidate: string | null, value: string | null): boolean {
  if (!candidate || !value) return false;
  const a = normalise(candidate);
  const b = normalise(value);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function isDirectiveMemory(memory: { source: string; category: string; metadata: string | null }): boolean {
  return memory.source === "operator" && memory.category === "directive" && Boolean(memory.metadata);
}

/** Rehydrate stored directive rows from the mind corpus. */
export function extractDirectives(
  corpus: { id?: string; source: string; category: string; content: string; metadata: string | null }[]
): StoredDirective[] {
  const out: StoredDirective[] = [];
  for (const memory of corpus) {
    if (!isDirectiveMemory(memory)) continue;
    try {
      const meta = JSON.parse(memory.metadata ?? "{}") as Partial<StoredDirective> & {
        active?: boolean;
        createdBy?: string | null;
      };
      if (meta.active === false) continue;
      if (typeof meta.lean !== "number" || typeof meta.goalsBias !== "number") continue;
      out.push({
        id: memory.id ?? "",
        raw: memory.content,
        scope: {
          competition: meta.scope?.competition ?? null,
          team: meta.scope?.team ?? null,
        },
        target: (meta.target ?? null) as DirectiveTarget,
        lean: clamp(meta.lean, -MAX_DIRECTIVE_LEAN, MAX_DIRECTIVE_LEAN),
        goalsBias: clamp(meta.goalsBias, -MAX_DIRECTIVE_GOALS_BIAS, MAX_DIRECTIVE_GOALS_BIAS),
        note: meta.note ?? "",
        confidence: typeof meta.confidence === "number" ? meta.confidence : 0.7,
        active: true,
        createdBy: meta.createdBy ?? null,
        createdAt: meta.createdAt ?? "",
      });
    } catch {
      /* a malformed directive must never break a prediction */
    }
  }
  return out;
}

/**
 * Resolve every active directive against one fixture.
 *
 * Returns the combined lean on the home side (negative meaning the away side) and
 * the combined goal shift, plus the directives that actually applied so the
 * rationale can name them.
 */
export function applyDirectives(
  directives: StoredDirective[],
  match: { homeTeam: string; awayTeam: string; competition: string }
): DirectiveEffect {
  if (directives.length === 0) return EMPTY_EFFECT;

  let homeLean = 0;
  let goalsBias = 0;
  const applied: StoredDirective[] = [];

  for (const directive of directives) {
    const teamIsHome = directive.scope.team ? nameMatches(directive.scope.team, match.homeTeam) : false;
    const teamIsAway = directive.scope.team ? nameMatches(directive.scope.team, match.awayTeam) : false;

    // A competition-scoped directive only applies to that competition.
    if (directive.scope.competition && !nameMatches(directive.scope.competition, match.competition)) continue;
    // A team-scoped directive only applies when one of the two sides is that team.
    if (directive.scope.team && !teamIsHome && !teamIsAway) continue;

    let lean = directive.lean;
    if (directive.target === "away") lean = -lean;
    else if (directive.target === "team" && teamIsAway) lean = -lean;

    homeLean += lean;
    goalsBias += directive.goalsBias;
    applied.push(directive);
  }

  if (applied.length === 0) return EMPTY_EFFECT;

  return {
    homeLean: clamp(homeLean, -MAX_DIRECTIVE_LEAN, MAX_DIRECTIVE_LEAN),
    goalsBias: clamp(goalsBias, -MAX_DIRECTIVE_GOALS_BIAS, MAX_DIRECTIVE_GOALS_BIAS),
    applied,
    notes: applied.map((d) => d.note).filter(Boolean),
  };
}

/**
 * Persist an operator instruction as a mind memory.
 *
 * Stored under `source: "operator"` rather than `"sports"` so the learner's own
 * sweeps never overwrite it, and so the reader can tell a human instruction
 * apart from something the model inferred.
 */
export async function saveDirective(params: {
  text: string;
  parsed: ParsedDirective;
  createdBy?: string | null;
}): Promise<StoredDirective | null> {
  const { text, parsed } = params;
  const tags = [
    "directive",
    parsed.scope.competition ? `competition:${normalise(parsed.scope.competition)}` : "scope:global",
    parsed.scope.team ? `team:${normalise(parsed.scope.team)}` : null,
    parsed.target ? `target:${parsed.target}` : null,
  ]
    .filter(Boolean)
    .join(",");

  const metadata = JSON.stringify({
    scope: parsed.scope,
    target: parsed.target,
    lean: parsed.lean,
    goalsBias: parsed.goalsBias,
    note: parsed.note,
    confidence: parsed.confidence,
    active: true,
    createdBy: params.createdBy ?? null,
    createdAt: new Date().toISOString(),
  });

  try {
    const row = await prisma.neuralMemory.create({
      data: {
        source: "operator",
        category: "directive",
        content: text.slice(0, 500),
        tags,
        metadata,
        confidence: parsed.confidence,
      },
    });
    return {
      id: row.id,
      raw: row.content,
      ...parsed,
      active: true,
      createdBy: params.createdBy ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  } catch (error) {
    log.error("failed to save directive", { error });
    return null;
  }
}

/** Every directive the operator has issued, newest first. */
export async function listDirectives(includeInactive = false): Promise<StoredDirective[]> {
  const rows = await prisma.neuralMemory
    .findMany({
      where: { source: "operator", category: "directive" },
      orderBy: { createdAt: "desc" },
      take: 100,
    })
    .catch(() => []);

  const parsed = extractDirectives(
    rows.map((r) => ({ id: r.id, source: r.source, category: r.category, content: r.content, metadata: r.metadata }))
  );
  const byId = new Map(parsed.map((d) => [d.id, d]));

  return rows
    .map((row) => {
      const directive = byId.get(row.id);
      if (directive) return { ...directive, createdAt: row.createdAt.toISOString() };
      return null;
    })
    .filter((d): d is StoredDirective => d !== null)
    .filter((d) => includeInactive || d.active);
}

/**
 * Turn a directive off without deleting it.
 *
 * Kept as history rather than deleted so the console can show what was once
 * instructed and when it stopped applying — deleting would make the model's
 * past behaviour unexplainable.
 */
export async function setDirectiveActive(id: string, active: boolean): Promise<boolean> {
  const row = await prisma.neuralMemory.findUnique({ where: { id } }).catch(() => null);
  if (!row || row.source !== "operator" || row.category !== "directive") return false;

  let meta: Record<string, unknown> = {};
  try {
    meta = JSON.parse(row.metadata ?? "{}") as Record<string, unknown>;
  } catch {
    meta = {};
  }

  await prisma.neuralMemory
    .update({ where: { id }, data: { metadata: JSON.stringify({ ...meta, active }) } })
    .catch(() => null);
  return true;
}
