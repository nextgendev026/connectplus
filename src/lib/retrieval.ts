/**
 * Retrieval: what reaches the prompt, in what order, and why.
 *
 * Recall used to be one ordered `findMany` plus a standing sort. Three problems
 * followed, and each of them is a way an answer goes wrong rather than a way the
 * code looks untidy:
 *
 *   1. **No provenance weighting.** A memory the model generated itself ranked
 *      beside a live platform reading. `memory-provenance.ts` now assigns
 *      standing; nothing consulted it.
 *   2. **No visibility filter.** A region-scoped or operator-only finding was
 *      eligible for a public answer, because nothing in the read path asked who
 *      was going to read it.
 *   3. **No budget and no contradiction handling.** Recall returned eight rows
 *      whatever they were. Two of those could be two members of one
 *      contradiction group — the model then had both and no way to know they
 *      disagreed, so it answered from whichever came first. And the eighth row
 *      could be a duplicate of the first, spending a fifth of the context on
 *      nothing.
 *
 * This module is the read path: filter, score, rerank, budget, explain. It is a
 * pure function over candidates the caller fetched, so the ranking is testable
 * without a database and every caller applies the same rule.
 *
 * **The retrieval reason is not decoration.** Every returned memory carries the
 * grounds on which it was selected, and the prompt gets a provenance summary.
 * The brief requires the assistant to say when evidence is missing and to
 * distinguish live data from memory from general knowledge — which is
 * unanswerable if the read path cannot state, for any given memory, why it is
 * there.
 */

import {
  effectiveVerification,
  isAssertable,
  provenanceWeight,
  summarizeForPrompt,
  visibilityAllows,
  visibilityReason,
  type Audience,
  type ProvenanceFacts,
  type RetrievalProvenanceSummary,
  type VerificationStatus,
} from "@/lib/memory-provenance";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Half-life of a memory's freshness weight, matching the retention model. */
export const FRESHNESS_HALF_LIFE_DAYS = 45;

/** Default context budget. Eight memories is roughly the point of diminishing returns. */
export const DEFAULT_LIMIT = 8;
export const DEFAULT_MAX_CHARS = 6_000;

export interface RetrievalCandidate extends ProvenanceFacts {
  id: string;
  tags?: string | null;
  confidence?: number | null;
  accessCount?: number | null;
  lastAccessedAt?: Date | null;
  /** Present on a Prisma row; carried through so callers keep their shape. */
  category?: string | null;
  metadata?: string | null;
  /** Optional semantic similarity in [0,1], when a vector tier is available. */
  similarity?: number | null;
}

export interface RetrievedMemory extends RetrievalCandidate {
  /** The composite score, for diagnostics. Not comparable across queries. */
  score: number;
  /** Why this memory was selected, in the terms an answer can repeat. */
  reasons: string[];
  verification: VerificationStatus;
  /** Whether it may be stated as fact, as opposed to cited with qualification. */
  assertable: boolean;
}

export interface RetrievalResult {
  memories: RetrievedMemory[];
  /** The provenance line for the prompt. */
  summary: RetrievalProvenanceSummary;
  /** Who was excluded and why — an operator diagnosing an empty answer needs this. */
  excluded: { id: string; reason: string }[];
  /** Memories dropped because a stronger member of their contradiction group won. */
  contradictionsSurfaced: { kept: string; dropped: string; subject?: string }[];
  /** True when the budget cut material that would otherwise have been returned. */
  budgetLimited: boolean;
  notes: string[];
}

export interface RetrievalOptions {
  /** The question being answered, used for the lexical relevance term. */
  query: string;
  limit?: number;
  maxChars?: number;
  audience?: Audience;
  /** Injectable clock, so freshness is testable. */
  now?: Date;
  /**
   * Allow expired material into the result. Off by default: an expired exchange
   * rate is worse than no exchange rate, because it is quotable. When on, the
   * memory is heavily penalised and marked, which is the right treatment for
   * "what did it used to be".
   */
  includeExpired?: boolean;
}

/**
 * Query terms, normalised for overlap scoring.
 *
 * Stopwords are stripped because they match every memory and therefore rank
 * nothing — including them dilutes the term fraction so that a memory matching
 * "the" and a memory matching the actual subject look equally relevant.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "than", "that", "this", "these", "those", "is", "are", "was",
  "were", "be", "been", "being", "of", "in", "on", "at", "to", "for", "from", "with", "by", "as", "it", "its", "we",
  "you", "they", "he", "she", "do", "does", "did", "not", "no", "how", "what", "when", "where", "which", "who", "why",
  "can", "could", "should", "would", "will", "just", "about", "into", "over", "up", "out", "so", "there", "here",
]);

export function queryTerms(query: string): string[] {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^a-z0-9']+/)) {
    const term = raw.trim();
    if (term.length < 3 || STOPWORDS.has(term)) continue;
    seen.add(term);
  }
  return [...seen];
}

/**
 * Fraction of query terms present in the memory's content or tags.
 *
 * Deliberately a *fraction*, not a count: a count favours long memories, and the
 * longest memory in the hive is usually the least specific. A substring test
 * rather than a token test because a stemmed match ("rate" in "exchange rates")
 * is what the reader meant, and a tokeniser here would need a stemmer to
 * reproduce it.
 */
export function relevance(candidate: RetrievalCandidate, terms: string[]): { score: number; hits: string[] } {
  if (terms.length === 0) return { score: 0.5, hits: [] };
  const haystack = `${candidate.content} ${candidate.tags ?? ""}`.toLowerCase();
  const hits = terms.filter((term) => haystack.includes(term));
  return { score: hits.length / terms.length, hits };
}

/** Exponential decay from last use, falling back to creation. Never zero. */
export function freshness(candidate: RetrievalCandidate, now: Date): number {
  const anchor = candidate.lastAccessedAt ?? candidate.createdAt;
  if (!anchor) return 0.7;
  const ageDays = Math.max(0, (now.getTime() - anchor.getTime()) / DAY_MS);
  return 0.4 + 0.6 * Math.pow(0.5, ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

/** Reinforcement is logarithmic so one hot memory cannot dominate permanently. */
function reinforcement(candidate: RetrievalCandidate): number {
  const uses = Math.max(candidate.accessCount ?? 0, 0);
  return 1 + Math.log1p(Math.min(uses, 50)) / Math.log1p(50);
}

/** Status multiplier for material that is not assertable. */
function statusFactor(status: VerificationStatus): number {
  switch (status) {
    case "operator_confirmed":
    case "corroborated":
    case "observed":
      return 1;
    case "unverified":
      return 0.75;
    case "expired":
      return 0.25;
    case "rejected":
      return 0;
  }
}

export interface ScoredCandidate {
  candidate: RetrievalCandidate;
  score: number;
  reasons: string[];
  verification: VerificationStatus;
  assertable: boolean;
}

/**
 * Score one candidate and explain the score.
 *
 * Multiplicative, like `provenanceWeight`, so a strong term match cannot rescue
 * a rejected memory and a confirmed memory cannot promote an irrelevant one.
 * Both have to hold for a memory to rank well, which is what "relevant and
 * trustworthy" means.
 */
export function scoreCandidate(
  candidate: RetrievalCandidate,
  terms: string[],
  now: Date
): ScoredCandidate {
  const status = effectiveVerification(candidate, now);
  const { score: rel, hits } = relevance(candidate, terms);
  const provenance = provenanceWeight(candidate, now);
  const fresh = freshness(candidate, now);
  const uses = reinforcement(candidate);
  const status_ = statusFactor(status);

  const score = rel * provenance * fresh * uses * status_;

  const reasons: string[] = [];
  if (terms.length > 0) reasons.push(`matched ${hits.length}/${terms.length} query terms`);
  reasons.push(`verification: ${status}`);
  reasons.push(`origin: ${candidate.sourceType ?? candidate.source ?? "unrecorded"}`);
  if (candidate.similarity !== null && candidate.similarity !== undefined) {
    reasons.push(`semantic similarity ${candidate.similarity.toFixed(2)}`);
  }
  if (candidate.lastAccessedAt) {
    const days = Math.round((now.getTime() - candidate.lastAccessedAt.getTime()) / DAY_MS);
    reasons.push(days <= 1 ? "used today" : `used ${days}d ago`);
  }
  if ((candidate.accessCount ?? 0) > 0) reasons.push(`recalled ${candidate.accessCount}×`);
  if (status === "expired" && candidate.expiresAt) {
    const days = Math.round((now.getTime() - candidate.expiresAt.getTime()) / DAY_MS);
    reasons.push(`expired ${days}d ago — cite as historical, not current`);
  }
  if (status === "rejected") reasons.push("operator rejected — must not be presented as truth");

  return { candidate, score, reasons, verification: status, assertable: isAssertable(candidate, now) };
}

/**
 * The read path: filter, score, rerank, budget, explain.
 *
 * The reranking step is where this stops being a sort. Two memories in the same
 * `contradictionGroup` disagree by definition, so returning both as current
 * truth is the failure mode the brief calls out — "conflicting memories must not
 * both be presented as current truth". The higher-scoring member is kept and the
 * other is dropped *and recorded*, because silently discarding half of a
 * disagreement is its own kind of dishonesty: an operator should be able to see
 * that the hive knows two things.
 */
export function retrieveMemories(candidates: RetrievalCandidate[], options: RetrievalOptions): RetrievalResult {
  const now = options.now ?? new Date();
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_MAX_CHARS);
  const audience: Audience = options.audience ?? "operator";
  const notes: string[] = [];
  const excluded: { id: string; reason: string }[] = [];

  const terms = queryTerms(options.query);
  if (terms.length === 0) notes.push("Query produced no scorable terms; ranking used standing and freshness only.");

  const eligible: ScoredCandidate[] = [];
  for (const candidate of candidates) {
    if (!visibilityAllows(candidate, audience)) {
      excluded.push({ id: candidate.id, reason: visibilityReason(candidate, audience) ?? "not visible to this audience" });
      continue;
    }
    const scored = scoreCandidate(candidate, terms, now);
    // Rejected material is excluded unconditionally, and the two conditions are
    // deliberately not combined: `includeExpired` is a caller asking for
    // *stale* material, and an earlier version tested it against the rejected
    // case too — so a request for historical rates silently reinstated claims an
    // operator had explicitly disbelieved. A rejected memory is a record that
    // something was disbelieved; it has no place in an answer at any setting.
    if (scored.verification === "rejected") {
      excluded.push({ id: candidate.id, reason: "verification status is rejected" });
      continue;
    }
    if (scored.verification === "expired" && !options.includeExpired) {
      excluded.push({ id: candidate.id, reason: "expired and expired material was not requested" });
      continue;
    }
    eligible.push(scored);
  }

  eligible.sort((a, b) => b.score - a.score);

  // Rerank: at most one member of a contradiction group survives, and duplicates
  // are collapsed before the budget is spent on them.
  //
  // This runs over *every* eligible candidate rather than stopping at the limit,
  // and the distinction is not cosmetic. An earlier version broke out of the
  // loop once `limit` representatives were chosen, so whether a disagreement was
  // recorded depended on where the loser happened to rank: a contradicting memory
  // scoring third was never examined, and the answer presented the winner as
  // settled fact with no note that the hive holds a conflicting claim. Grouping
  // first and ranging second makes the record independent of the budget.
  const contradictionsSurfaced: RetrievalResult["contradictionsSurfaced"] = [];
  const seenGroups = new Map<string, string>();
  const seenContent = new Set<string>();
  const representatives: ScoredCandidate[] = [];

  for (const scored of eligible) {
    const fingerprint = scored.candidate.content.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
    if (seenContent.has(fingerprint)) {
      excluded.push({ id: scored.candidate.id, reason: "duplicate of a higher-scoring memory in this result" });
      continue;
    }

    const group = scored.candidate.contradictionGroup;
    if (group) {
      const winner = seenGroups.get(group);
      if (winner) {
        contradictionsSurfaced.push({ kept: winner, dropped: scored.candidate.id });
        excluded.push({
          id: scored.candidate.id,
          reason: `member of contradiction group "${group}", which a higher-scoring memory already represents`,
        });
        continue;
      }
      seenGroups.set(group, scored.candidate.id);
      scored.reasons.push(`represents contradiction group "${group}" — another memory in this hive disagrees`);
    }

    seenContent.add(fingerprint);
    representatives.push(scored);
  }

  const selected = representatives.slice(0, limit);
  if (representatives.length > selected.length) {
    notes.push(
      `${representatives.length - selected.length} further distinct memory/memories were available and not returned — the limit of ${limit} was reached.`
    );
  }

  // The budget is applied after reranking, so duplicates and lost contradiction
  // members never consume it. Applying it first would waste context on material
  // that is then discarded.
  const memories: RetrievedMemory[] = [];
  let usedChars = 0;
  let budgetLimited = false;
  for (const scored of selected) {
    const cost = scored.candidate.content.length;
    if (usedChars + cost > maxChars && memories.length > 0) {
      budgetLimited = true;
      excluded.push({ id: scored.candidate.id, reason: `context budget of ${maxChars} characters was reached` });
      continue;
    }
    usedChars += cost;
    memories.push({
      ...scored.candidate,
      score: scored.score,
      reasons: scored.reasons,
      verification: scored.verification,
      assertable: scored.assertable,
    });
  }

  const summary = summarizeForPrompt(memories, now);
  if (excluded.length > 0) notes.push(`${excluded.length} candidate(s) excluded before ranking.`);
  if (contradictionsSurfaced.length > 0) {
    notes.push(
      `${contradictionsSurfaced.length} contradicting memory/memories were withheld — the hive holds conflicting claims and the answer should not present either as settled.`
    );
  }
  if (budgetLimited) notes.push(`Context budget (${maxChars} characters) limited the result to ${memories.length} memories.`);
  notes.push(summary.line);

  return { memories, summary, excluded, contradictionsSurfaced, budgetLimited, notes };
}

/**
 * The block that goes into a prompt, with the provenance line attached.
 *
 * Every memory is labelled with its verification state and origin at the point
 * of use rather than only in aggregate, because a model that is told "3 of these
 * are unconfirmed" still has to work out which three. Labelling each one removes
 * that inference, and inference is where a model is most confident and least
 * reliable.
 */
export function formatMemoriesForPrompt(memories: RetrievedMemory[], now: Date = new Date()): string {
  if (memories.length === 0) return "";

  const lines = memories.map((memory, index) => {
    const state = effectiveVerification(memory, now);
    const marker = memory.assertable ? "CONFIRMED" : state === "expired" ? "EXPIRED" : "UNCONFIRMED";
    const origin = memory.sourceUrl ? `, source ${memory.sourceUrl.slice(0, 120)}` : "";
    return `[${index + 1}] (${marker} — ${state}${origin}) ${memory.content.slice(0, 600)}`;
  });

  const summary = summarizeForPrompt(memories, now);
  return [summary.line, "", ...lines].join("\n");
}
