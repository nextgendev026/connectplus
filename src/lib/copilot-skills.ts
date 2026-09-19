/**
 * What the copilot learns from being used.
 *
 * The Brain Pilot is wired into the app's brain, and a brain that is wired in
 * but does not learn from its own outcomes is just a very confident autocomplete.
 * Every decision a writer makes about a proposed edit — kept, discarded, applied
 * as a fix, turned into a published article — is a labelled example of what this
 * publication actually wants. This module records those decisions and turns them
 * into a short, honest brief that goes back into the pilot's prompt.
 *
 * Two design choices are load-bearing:
 *
 *   • **Outcomes, not conversations.** A kept edit is a fact about quality; a
 *     chat log is not. Recording the decision keeps the table small enough to
 *     summarise in one query and specific enough to act on.
 *   • **A brief, not a fine-tune.** The learnings are compressed into a handful
 *     of sentences ("writers keep 4 of 5 tighten edits; they discard most expand
 *     edits") and injected as guidance. That is checkable, reversible and cheap —
 *     and when the numbers change, the guidance changes with them.
 */

import { prisma } from "./prisma";
import { createLogger } from "./logger";

const log = createLogger("copilot-skills");

export const COPILOT_OUTCOME_SOURCE = "copilot-outcome";
export const COPILOT_OUTCOME_CATEGORY = "editor";

export type CopilotOutcomeKind =
  /** A proposed edit the writer kept. */
  | "kept"
  /** A proposed edit the writer threw away. */
  | "discarded"
  /** A deterministic inline fix applied in place. */
  | "fix"
  /** A full article the writer put in the composer. */
  | "article"
  /** An action that came back with nothing to propose. */
  | "empty";

export interface CopilotOutcome {
  /** The pilot action or copilot command (`improve`, `tighten`, `article`, …). */
  action: string;
  kind: CopilotOutcomeKind;
  /** The composer field the edit touched, when it had one. */
  field?: string;
  /** The op kind, for edit-level detail. */
  opKind?: string;
  /** How many edits the reply contained, so a "keep all" reads correctly. */
  edits?: number;
  at?: string;
}

/** Bound a free-text value before it goes anywhere near the database. */
function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/**
 * Record one decision.
 *
 * Never throws: this is telemetry on the writing path, and a writer's edit
 * must not fail because the learning table was busy. Failures are logged and
 * dropped.
 */
export async function recordCopilotOutcome(outcome: CopilotOutcome): Promise<boolean> {
  const action = clip(outcome.action, 40);
  if (!action) return false;
  const metadata = JSON.stringify({
    action,
    kind: outcome.kind,
    field: clip(outcome.field, 20),
    opKind: clip(outcome.opKind, 40),
    edits: typeof outcome.edits === "number" && Number.isFinite(outcome.edits) ? outcome.edits : undefined,
    at: outcome.at ?? new Date().toISOString(),
  });
  try {
    await prisma.neuralMemory.create({
      data: {
        source: COPILOT_OUTCOME_SOURCE,
        category: COPILOT_OUTCOME_CATEGORY,
        content: `${action}: ${outcome.kind}${outcome.field ? ` (${outcome.field})` : ""}`.slice(0, 500),
        tags: [action, outcome.kind, clip(outcome.field, 20)].filter(Boolean).join(","),
        confidence: 1,
        metadata,
      },
      select: { id: true },
    });
    return true;
  } catch (error) {
    log.warn("copilot outcome not recorded", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** Record several at once, tolerating individual failures. */
export async function recordCopilotOutcomes(outcomes: CopilotOutcome[]): Promise<number> {
  let stored = 0;
  for (const outcome of outcomes.slice(0, 25)) {
    if (await recordCopilotOutcome(outcome)) stored += 1;
  }
  return stored;
}

export interface CopilotSkillProfile {
  total: number;
  kept: number;
  discarded: number;
  /** Kept ÷ decided, or null when nothing has been decided yet. */
  keptRate: number | null;
  perAction: Record<string, { kept: number; discarded: number }>;
  /** Composer fields the writers most often accept changes to. */
  topFields: { field: string; count: number }[];
  /** The corrections the inline rail applies most — the recurring error idioms. */
  topFixes: { kind: string; count: number }[];
  articles: number;
  lastAt: string | null;
}

/** Roll outcomes up into the profile the notes are written from. Pure. */
export function summarizeCopilotSkills(outcomes: CopilotOutcome[]): CopilotSkillProfile {
  const perAction: Record<string, { kept: number; discarded: number }> = {};
  const fields = new Map<string, number>();
  const fixes = new Map<string, number>();
  let kept = 0;
  let discarded = 0;
  let articles = 0;
  let lastAt: string | null = null;

  for (const outcome of outcomes) {
    const action = clip(outcome.action, 40) || "unknown";
    const bucket = (perAction[action] ??= { kept: 0, discarded: 0 });
    if (outcome.kind === "kept") {
      kept += 1;
      bucket.kept += 1;
    } else if (outcome.kind === "discarded") {
      discarded += 1;
      bucket.discarded += 1;
    } else if (outcome.kind === "article") {
      articles += 1;
    } else if (outcome.kind === "fix") {
      const kind = clip(outcome.opKind ?? outcome.field ?? "correction", 40);
      fixes.set(kind, (fixes.get(kind) ?? 0) + 1);
    }
    const field = clip(outcome.field, 20);
    if (field && (outcome.kind === "kept" || outcome.kind === "fix")) {
      fields.set(field, (fields.get(field) ?? 0) + 1);
    }
    if (outcome.at && (!lastAt || outcome.at > lastAt)) lastAt = outcome.at;
  }

  const decided = kept + discarded;
  const top = <T extends { count: number }>(rows: T[]) => rows.sort((a, b) => b.count - a.count).slice(0, 4);

  return {
    total: outcomes.length,
    kept,
    discarded,
    keptRate: decided > 0 ? kept / decided : null,
    perAction,
    topFields: top([...fields].map(([field, count]) => ({ field, count }))),
    topFixes: top([...fixes].map(([kind, count]) => ({ kind, count }))),
    articles,
    lastAt,
  };
}

/**
 * Turn the profile into the lines the pilot reads.
 *
 * Only statements the numbers actually support: a rate is only quoted once
 * there is a sample behind it, and nothing is said at all about an action with
 * no decisions yet. A prompt that says "writers dislike long headlines" because
 * one was discarded is a prompt that teaches the model a falsehood.
 */
export function copilotSkillNotes(profile: CopilotSkillProfile): string[] {
  const notes: string[] = [];

  if (profile.keptRate !== null && profile.kept + profile.discarded >= 5) {
    const percent = Math.round(profile.keptRate * 100);
    notes.push(
      `Writers here keep about ${percent}% of proposed edits (${profile.kept} kept, ${profile.discarded} discarded).`
    );
  }

  const perAction = Object.entries(profile.perAction)
    .map(([action, counts]) => ({ action, ...counts, decided: counts.kept + counts.discarded }))
    .filter((row) => row.decided >= 3)
    .sort((a, b) => b.decided - a.decided)
    .slice(0, 4);

  for (const row of perAction) {
    const rate = Math.round((row.kept / row.decided) * 100);
    if (rate <= 30) notes.push(`"${row.action}" suggestions are usually rejected (${rate}% kept) — be conservative and only propose a change that is clearly an improvement.`);
    else if (rate >= 80) notes.push(`"${row.action}" suggestions are usually accepted (${rate}% kept) — this is the work the writers want most.`);
  }

  if (profile.topFixes.length > 0) {
    notes.push(`The corrections applied most often are: ${profile.topFixes.map((f) => f.kind).join(", ")}.`);
  }
  if (profile.topFields.length > 0) {
    notes.push(`The fields writers most often accept changes to: ${profile.topFields.map((f) => f.field).join(", ")}.`);
  }
  return notes;
}

/**
 * The notes for the live pilot prompt.
 *
 * One indexed read on a small source; failures and an empty history both mean
 * "no notes", because the pilot must work on a publication that has never used
 * it before.
 */
export async function copilotSkillNotesFromStore(limit = 200): Promise<string[]> {
  try {
    const rows = await prisma.neuralMemory.findMany({
      where: { source: COPILOT_OUTCOME_SOURCE },
      orderBy: { createdAt: "desc" },
      take: Math.max(10, Math.min(500, limit)),
      select: { metadata: true },
    });
    const outcomes: CopilotOutcome[] = [];
    for (const row of rows) {
      if (!row.metadata) continue;
      try {
        const parsed = JSON.parse(row.metadata) as CopilotOutcome;
        if (parsed && typeof parsed.action === "string" && typeof parsed.kind === "string") outcomes.push(parsed);
      } catch {
        // A malformed row is one lost example, not a broken prompt.
      }
    }
    return copilotSkillNotes(summarizeCopilotSkills(outcomes));
  } catch (error) {
    log.warn("copilot skills unavailable", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/** The profile itself, for the admin console. */
export async function copilotSkillsReport(): Promise<CopilotSkillProfile> {
  const rows = await prisma.neuralMemory
    .findMany({
      where: { source: COPILOT_OUTCOME_SOURCE },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { metadata: true },
    })
    .catch(() => [] as { metadata: string | null }[]);
  const outcomes: CopilotOutcome[] = [];
  for (const row of rows) {
    if (!row.metadata) continue;
    try {
      outcomes.push(JSON.parse(row.metadata) as CopilotOutcome);
    } catch {
      // ignore
    }
  }
  return summarizeCopilotSkills(outcomes);
}

/** Validate what arrives on the wire before it is stored. */
export function coerceCopilotOutcome(value: unknown): CopilotOutcome | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const action = clip(record.action, 40);
  const kind = clip(record.kind, 20);
  const kinds: CopilotOutcomeKind[] = ["kept", "discarded", "fix", "article", "empty"];
  if (!action || !kinds.includes(kind as CopilotOutcomeKind)) return null;
  return {
    action,
    kind: kind as CopilotOutcomeKind,
    field: clip(record.field, 20) || undefined,
    opKind: clip(record.opKind, 40) || undefined,
    edits: typeof record.edits === "number" && Number.isFinite(record.edits) ? Math.max(0, Math.round(record.edits)) : undefined,
    at: clip(record.at, 40) || undefined,
  };
}
