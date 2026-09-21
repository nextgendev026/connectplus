/**
 * Memory provenance: what the hive is allowed to assert, and on what grounds.
 *
 * The hive could accumulate knowledge but had no vocabulary for *knowing* it.
 * Every memory carried a `confidence` float, which answers "how sure is the
 * model" but not any of the questions that actually decide an answer:
 *
 *   - **Where did this come from?** A platform count read from the database, a
 *     claim scraped from an anonymous blog and a sentence the model generated
 *     itself all looked identical. The last of those is the dangerous one: a
 *     model's own earlier output, re-ingested as evidence, becomes a fact by
 *     repetition.
 *   - **Is it still true?** "USD/KES is 129" was stored with the same standing
 *     as "Nairobi is in Kenya". One of those has a shelf life of minutes.
 *   - **Has anyone checked?** Nothing distinguished a claim observed once from
 *     one corroborated by three independent sources or confirmed by an operator.
 *   - **Does it contradict something we already hold?** Both memories were
 *     returned by recall, in arbitrary order, and the model was free to pick
 *     either.
 *
 * This module answers those four questions and nothing else. It is deliberately
 * pure — no database access, no fetching — so the answers are testable and so
 * every caller applies the same rule. Storage and retrieval live elsewhere; the
 * *judgement* lives here.
 *
 * The governing principle throughout: **an unverified memory is not a fact, and
 * the assistant must be able to say so.** That is why the default state is
 * `unverified` rather than `observed` — an unknown provenance is not evidence
 * of having observed something.
 */

import { createHash } from "node:crypto";
import { createLogger } from "@/lib/logger";

const log = createLogger("memory-provenance");

/** The verification vocabulary. `memory-provenance.ts` is its single source. */
export const VERIFICATION_STATES = [
  /** Ingested with no provenance recorded. Not assertable as fact. */
  "unverified",
  /** We saw it: a live platform reading, or one source we read directly. */
  "observed",
  /** More than one independent source agrees. */
  "corroborated",
  /** An operator confirmed it. The highest standing available. */
  "operator_confirmed",
  /** Deliberately disbelieved. Never surfaced as truth, retained as a record. */
  "rejected",
  /** Past its expiry. The claim may have been true; it is not assertable now. */
  "expired",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATES)[number];

export const SOURCE_TYPES = ["platform", "internal", "external", "model", "operator"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const SENSITIVITIES = ["public", "internal", "sensitive"] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/**
 * Who is reading the answer. Two audiences only, deliberately.
 *
 * A finer-grained model would invite the belief that it is enforced somewhere
 * it is not. `public` is what a reader of the site sees; `operator` is an
 * authenticated admin console. Anything the operator console needs beyond that
 * is a *permission* question, and `lib/policies` owns permissions.
 */
export type Audience = "public" | "operator";

/** The subset of a memory this module reasons about. */
export interface ProvenanceFacts {
  content: string;
  source?: string | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  sourceHash?: string | null;
  sourceReliability?: number | null;
  observedAt?: Date | null;
  expiresAt?: Date | null;
  verificationStatus?: string | null;
  sensitivity?: string | null;
  scope?: string | null;
  contradictionGroup?: string | null;
  supersedes?: string | null;
  createdAt?: Date | null;
}

/**
 * Default reliability per origin, before any corroboration.
 *
 * These are *priors*, not measurements, and the numbers say so honestly: a
 * platform reading is high because it is a direct query against our own data; a
 * model statement is the lowest because a model asserting something is not
 * evidence for it, however fluent the sentence.
 *
 * `external` is deliberately mid-range rather than low. Treating all external
 * content as untrustworthy would be as useless as trusting all of it — most of
 * a news feed is accurate, and the mechanism that catches the rest is
 * corroboration and expiry, not a pessimistic constant.
 */
export const SOURCE_RELIABILITY: Record<SourceType, number> = {
  platform: 0.95,
  operator: 0.95,
  internal: 0.8,
  external: 0.6,
  model: 0.35,
};

/**
 * Content shapes that stop being true quickly.
 *
 * The point is not to parse meaning — it is to refuse to leave a volatile number
 * in the hive with no expiry. A false positive costs an unnecessary expiry on a
 * durable fact, which is cheap and self-correcting: the memory is re-observed
 * and re-stored. A false negative leaves a stale exchange rate to be quoted in
 * six months, which is not.
 */
const VOLATILE_PATTERNS: { pattern: RegExp; ttlMs: number; label: string }[] = [
  // Live scores and standings.
  { pattern: /\b\d{1,2}\s*[-–]\s*\d{1,2}\b.*\b(full[- ]time|half[- ]time|minute|ft|ht)\b/i, ttlMs: 6 * 3600_000, label: "match-result" },
  { pattern: /\b(live|now playing|currently playing|listeners?|viewers?)\b/i, ttlMs: 2 * 3600_000, label: "live-state" },
  // Exchange rates and prices.
  { pattern: /\b(usd|kes|eur|gbp|tzs|ugx|ngn|zar|shilling|dollar)\b[^.]{0,24}\b\d+([.,]\d+)?\b/i, ttlMs: 12 * 3600_000, label: "rate" },
  { pattern: /\b(rate|price|cost|premium|subscription|fee)\b[^.]{0,24}\b\d+([.,]\d+)?\b/i, ttlMs: 7 * 24 * 3600_000, label: "price" },
  // Counts and standings, which are true only as of a moment.
  { pattern: /\b(\d[\d,]*)\s*(users?|posts?|views?|visitors?|subscribers?|members?|downloads?)\b/i, ttlMs: 24 * 3600_000, label: "count" },
  { pattern: /\b(today|yesterday|this (week|month|year)|last (week|month|year))\b/i, ttlMs: 7 * 24 * 3600_000, label: "relative-time" },
];

/** Newest-day window used for relative-time content. */
export interface VolatilityAssessment {
  volatile: boolean;
  ttlMs: number | null;
  reason: string;
}

export function assessVolatility(content: string): VolatilityAssessment {
  // Shortest TTL wins when several patterns match: a live match with a scoreline
  // is volatile for minutes, whatever the "count" pattern would have said.
  let best: { ttlMs: number; label: string } | null = null;
  for (const { pattern, ttlMs, label } of VOLATILE_PATTERNS) {
    if (!pattern.test(content)) continue;
    if (!best || ttlMs < best.ttlMs) best = { ttlMs, label };
  }
  return best
    ? { volatile: true, ttlMs: best.ttlMs, reason: `content looks like ${best.label}` }
    : { volatile: false, ttlMs: null, reason: "no volatility pattern matched" };
}

/** Canonical content hash, so a re-fetched document is recognised as the same one. */
export function contentHash(content: string): string {
  return createHash("sha256").update(content.trim().replace(/\s+/g, " ")).digest("hex");
}

/**
 * Classify a memory's origin from what the writer knew.
 *
 * An explicit `sourceType` always wins — a caller that has stated its origin is
 * better informed than a heuristic over a URL. Only when it is absent does the
 * URL decide, and the outcome of guessing is `internal` rather than `external`:
 * misfiling our own data as untrustworthy would suppress it from answers, while
 * misfiling external data as internal would promote it. Suppression is the
 * safer error.
 */
export function classifySourceType(memory: ProvenanceFacts): SourceType {
  const declared = memory.sourceType?.toLowerCase();
  if (declared && (SOURCE_TYPES as readonly string[]).includes(declared)) return declared as SourceType;

  const source = (memory.source ?? "").toLowerCase();
  if (source === "operator" || source === "admin") return "operator";
  if (source === "model" || source === "llm" || source === "generated") return "model";
  if (source === "external" || memory.sourceUrl) return "external";
  if (source === "hive" || source === "platform") return "platform";
  return "internal";
}

/**
 * The verification state as of *now*.
 *
 * Expiry is computed rather than trusted. A row still marked `corroborated`
 * whose `expiresAt` has passed is `expired` the moment it is examined, whether
 * or not a sweep has run — because a sweep can fail, be disabled, or simply not
 * have run since the moment passed, and a stale fact presented as current is
 * exactly the failure this module exists to prevent.
 */
export function effectiveVerification(memory: ProvenanceFacts, now: Date = new Date()): VerificationStatus {
  const stored = (memory.verificationStatus ?? "unverified").toLowerCase();
  if (stored === "rejected") return "rejected";

  if (memory.expiresAt && memory.expiresAt.getTime() <= now.getTime()) return "expired";

  return (VERIFICATION_STATES as readonly string[]).includes(stored) ? (stored as VerificationStatus) : "unverified";
}

/**
 * May this memory be stated as a fact?
 *
 * `unverified` and `expired` are not failures — they are memories the assistant
 * may still *mention*, clearly marked as unconfirmed. What they must not be is
 * asserted, and this predicate is what draws that line in one place.
 */
export function isAssertable(memory: ProvenanceFacts, now: Date = new Date()): boolean {
  const state = effectiveVerification(memory, now);
  return state === "observed" || state === "corroborated" || state === "operator_confirmed";
}

/** Standing in a weighted ranking, 0–1. Never zero: a memory may still be cited. */
export function provenanceWeight(memory: ProvenanceFacts, now: Date = new Date()): number {
  const state = effectiveVerification(memory, now);
  const stateScore: Record<VerificationStatus, number> = {
    operator_confirmed: 1,
    corroborated: 0.85,
    observed: 0.65,
    unverified: 0.3,
    expired: 0.1,
    rejected: 0.05,
  };
  const reliability = normalizeReliability(memory.sourceReliability ?? SOURCE_RELIABILITY[classifySourceType(memory)]);
  // Multiplicative rather than additive, so a high state cannot rescue an
  // untrustworthy origin and a trusted origin cannot promote a claim nobody
  // verified. Both have to be good for the memory to rank well.
  return stateScore[state] * (0.5 + 0.5 * reliability);
}

function normalizeReliability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * Visibility: may this memory be shown to this audience?
 *
 * Two independent conditions, both required. `sensitivity` is about the content
 * (an operator-only finding, a payment detail) and `scope` is about the domain
 * (a region, a single tenant). Conflating them is how a region-scoped finding
 * ends up on the public homepage because someone remembered to set one field.
 */
export function visibilityAllows(memory: ProvenanceFacts, audience: Audience): boolean {
  const sensitivity = (memory.sensitivity ?? "internal").toLowerCase();
  const scope = (memory.scope ?? "platform").toLowerCase();

  if (audience === "operator") return true;
  if (sensitivity !== "public") return false;
  return scope === "platform" || scope === "public";
}

/** Why a memory was excluded, in words an operator or a log can use. */
export function visibilityReason(memory: ProvenanceFacts, audience: Audience): string | null {
  if (visibilityAllows(memory, audience)) return null;
  const sensitivity = (memory.sensitivity ?? "internal").toLowerCase();
  const scope = (memory.scope ?? "platform").toLowerCase();
  if (sensitivity !== "public") return `sensitivity is "${sensitivity}"`;
  return `scope is "${scope}"`;
}

/**
 * The facts a memory states, as (subject, number) pairs.
 *
 * This is a deliberately shallow extraction. Its job is to catch the *cheap*
 * contradiction — two memories about the same thing with different numbers —
 * and not to attempt natural-language inference, which would produce confident
 * false accusations of contradiction. Missing a subtle conflict costs us what
 * the status quo already cost; inventing one costs the hive a real memory.
 */
export function extractClaims(content: string): { subject: string; value: string }[] {
  const claims: { subject: string; value: string }[] = [];
  const text = content.replace(/\s+/g, " ");

  // "subject ... 1,234" — the subject is the few words before the number, with
  // anything that is clearly punctuation or filler stripped out.
  const numberPattern = /([A-Za-z][A-Za-z0-9/'’._-]*(?:\s+[A-Za-z][A-Za-z0-9/'’._-]*){0,3})\s*(?:is|are|was|were|:|at|=|of)?\s*([\d][\d,.]*)/gi;
  for (const match of text.matchAll(numberPattern)) {
    const subject = normalizeSubject(match[1] ?? "");
    const value = (match[2] ?? "").replace(/,/g, "");
    if (subject.length >= 3 && value.length > 0) claims.push({ subject, value });
  }
  return claims;
}

const SUBJECT_STOPWORDS = new Set([
  "the", "a", "an", "there", "it", "this", "that", "and", "or", "but", "in", "on", "of", "for", "from", "with", "by",
]);

function normalizeSubject(subject: string): string {
  return subject
    .toLowerCase()
    .replace(/[^a-z0-9\s/._-]/g, "")
    .split(/\s+/)
    .filter((w) => w && !SUBJECT_STOPWORDS.has(w))
    .join(" ")
    .trim();
}

export interface Contradiction {
  /** The subject both memories make a claim about. */
  subject: string;
  /** The value held by the memory under consideration. */
  incoming: string;
  /** The value held by an existing memory. */
  existing: string;
  /** Content of the existing memory, so the report can name it. */
  existingContent: string;
}

/**
 * Do two memories disagree about the same thing?
 *
 * Only an exact subject match with a *different* numeric value counts. Two
 * statements about the same subject with the same number are corroboration, and
 * one with no number for the compared subject says nothing conflicting.
 *
 * This is intentionally narrow, and the narrowness is the design: an accusation
 * of contradiction suppresses a memory, so a false positive destroys
 * information. A false negative leaves the status quo — both memories retained,
 * which the caller may still resolve by corroboration.
 */
export function findContradictions(
  incoming: ProvenanceFacts,
  existing: { content: string; id?: string }[]
): Contradiction[] {
  const incomingClaims = extractClaims(incoming.content);
  if (incomingClaims.length === 0) return [];

  const found: Contradiction[] = [];
  for (const other of existing) {
    if (other.content === incoming.content) continue;
    const otherClaims = extractClaims(other.content);
    if (otherClaims.length === 0) continue;

    for (const a of incomingClaims) {
      for (const b of otherClaims) {
        if (a.subject !== b.subject) continue;
        if (a.value === b.value) continue;
        found.push({ subject: a.subject, incoming: a.value, existing: b.value, existingContent: other.content.slice(0, 200) });
      }
    }
  }
  return found;
}

/**
 * Build the provenance fields for a new memory.
 *
 * The two decisions worth naming:
 *
 *   - A memory the model generated gets `model` as its type no matter what the
 *     caller said, because that is the single most important origin to record
 *     accurately and the easiest to lose. A generated sentence re-ingested as
 *     evidence becomes a fact by repetition.
 *   - An expiry is set whenever the content looks volatile, using the shortest
 *     matching window. Content the caller explicitly says is durable
 *     (`expiresAt: null` with a non-volatile body) is left alone.
 */
export function deriveProvenance(
  memory: ProvenanceFacts & { generatedByModel?: boolean },
  now: Date = new Date()
): {
  sourceType: SourceType;
  sourceHash: string | null;
  sourceReliability: number;
  observedAt: Date;
  expiresAt: Date | null;
  verificationStatus: VerificationStatus;
  notes: string[];
} {
  const notes: string[] = [];
  const sourceType: SourceType = memory.generatedByModel ? "model" : classifySourceType(memory);
  if (memory.generatedByModel && memory.sourceType && memory.sourceType !== "model") {
    notes.push(`sourceType "${memory.sourceType}" overridden to "model" because the content was model-generated`);
  }

  const volatility = assessVolatility(memory.content);
  const declaredExpiry = memory.expiresAt === undefined ? "unset" : memory.expiresAt === null ? "never" : "set";

  let expiresAt: Date | null;
  if (declaredExpiry === "set") {
    expiresAt = memory.expiresAt ?? null;
  } else if (declaredExpiry === "never") {
    expiresAt = null;
  } else if (volatility.volatile && volatility.ttlMs !== null) {
    expiresAt = new Date(now.getTime() + volatility.ttlMs);
    notes.push(`expiry set to ${volatility.ttlMs / 3600_000}h — ${volatility.reason}`);
  } else {
    // External material with no explicit expiry gets one anyway. An undated
    // scraped claim is the case that rots silently, and a long expiry is a
    // cheap insurance against it.
    expiresAt = sourceType === "external" ? new Date(now.getTime() + 90 * 24 * 3600_000) : null;
    if (expiresAt) notes.push("expiry set to 90d — external material with no declared lifetime");
  }

  // Reliability is only ever *lowered* here, never raised: a caller may know its
  // source is worse than the prior, but not that it is better than the platform's
  // own reading.
  const prior = SOURCE_RELIABILITY[sourceType];
  const declared = memory.sourceReliability;
  const sourceReliability =
    declared === null || declared === undefined || !Number.isFinite(declared)
      ? prior
      : Math.min(normalizeReliability(declared), prior);

  if (memory.sourceHash) {
    notes.push("content hash supplied by the caller");
  } else if (memory.content.trim().length > 0 && sourceType === "external") {
    notes.push("content hash derived from the fetched body");
  }

  // An observation timestamp for platform and internal data is "now" because we
  // are reading it now. For external material it should be the publication time,
  // which the caller must supply — defaulting to now would date a syndicated
  // article to the moment we syndicated it.
  const observedAt = memory.observedAt ?? now;

  const stored = (memory.verificationStatus ?? "").toLowerCase();
  const verificationStatus: VerificationStatus =
    stored && (VERIFICATION_STATES as readonly string[]).includes(stored)
      ? (stored as VerificationStatus)
      : sourceType === "platform" || sourceType === "operator"
        ? "observed"
        : "unverified";

  return {
    sourceType,
    sourceHash: memory.sourceHash ?? (sourceType === "external" ? contentHash(memory.content) : null),
    sourceReliability,
    observedAt,
    expiresAt,
    verificationStatus,
    notes,
  };
}

export interface RetrievalProvenanceSummary {
  assertable: number;
  unverified: number;
  expired: number;
  rejected: number;
  /** True when the answer must say that some material is unconfirmed. */
  mustQualify: boolean;
  /** One line suitable for placing in a prompt, so the model knows its footing. */
  line: string;
}

/**
 * Summarise a set of retrieved memories for the model's benefit.
 *
 * The model cannot mark its own uncertainty without being told what it knows, so
 * this produces the *line* that goes into the prompt — the same reason every
 * answer is required to distinguish live data, learned memory and general
 * knowledge. A retrieval set that is entirely unverified produces an explicit
 * instruction to say so, which is the difference between a confidently wrong
 * answer and an honest one.
 */
export function summarizeForPrompt(
  memories: ProvenanceFacts[],
  now: Date = new Date()
): RetrievalProvenanceSummary {
  let assertable = 0;
  let unverified = 0;
  let expired = 0;
  let rejected = 0;

  for (const memory of memories) {
    switch (effectiveVerification(memory, now)) {
      case "observed":
      case "corroborated":
      case "operator_confirmed":
        assertable++;
        break;
      case "expired":
        expired++;
        break;
      case "rejected":
        rejected++;
        break;
      default:
        unverified++;
    }
  }

  const parts: string[] = [];
  if (assertable > 0) parts.push(`${assertable} confirmed`);
  if (unverified > 0) parts.push(`${unverified} unconfirmed`);
  if (expired > 0) parts.push(`${expired} expired`);
  if (rejected > 0) parts.push(`${rejected} rejected`);

  const mustQualify = assertable === 0 && memories.length > 0;
  const line = memories.length === 0
    ? "No stored memories were retrieved for this question."
    : `Retrieved ${memories.length} stored memories (${parts.join(", ")}).${mustQualify ? " None is confirmed — present anything drawn from them as unverified, and say so." : ""}`;

  // A rejected memory reaching a prompt is a bug, not a data state. It is logged
  // rather than thrown because the answer should still be produced.
  if (rejected > 0) log.warn("rejected memories reached a prompt", { rejected });

  return { assertable, unverified, expired, rejected, mustQualify, line };
}

/** A human-readable provenance line for the admin console's memory browser. */
export function describeProvenance(memory: ProvenanceFacts, now: Date = new Date()): string {
  const state = effectiveVerification(memory, now);
  const type = classifySourceType(memory);
  const reliability = Math.round(normalizeReliability(memory.sourceReliability ?? SOURCE_RELIABILITY[type]) * 100);
  const origin = memory.sourceUrl ? ` from ${hostOf(memory.sourceUrl)}` : "";
  const expiry = memory.expiresAt ? `, expires ${memory.expiresAt.toISOString().slice(0, 10)}` : "";
  const scope = (memory.scope ?? "platform") === "platform" ? "" : `, scope ${memory.scope}`;
  return `${state} · ${type}${origin} · reliability ${reliability}%${expiry}${scope}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "an unparseable URL";
  }
}
