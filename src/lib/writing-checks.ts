/**
 * Inline writing checks — the deterministic half of the studio copilot.
 *
 * Grammarly's shape, not its scale: every issue is a *point in the draft*
 * (a character range plus an optional replacement), so the composer can
 * underline it in place and apply the fix without a round trip. That means the
 * checker must be pure and synchronous — it runs on every keystroke after a
 * short debounce, and it must never depend on a provider being configured.
 *
 * The rules are deliberately conservative. A false positive that rewrites a
 * writer's sentence is far worse than a missed nitpick, so anything requiring
 * real semantic judgement (passive voice, weak verbs, tone) is reported as
 * advice with no `replacement` rather than an automatic fix. Only mechanical
 * faults — spelling from a fixed list, wordiness, redundancy, doubled words and
 * broken spacing — carry a replacement, because those are the ones a machine
 * can apply without changing meaning.
 */

export type CheckKind = "correctness" | "clarity" | "engagement" | "style";

export type CheckSeverity = "high" | "medium" | "low";

export interface WritingSuggestion {
  /** Stable across runs so the UI can dismiss one without losing the others. */
  id: string;
  kind: CheckKind;
  /** Machine name of the rule, for tests and telemetry — never shown raw. */
  rule: string;
  /** One-line, reader-facing explanation. */
  message: string;
  /** The exact substring flagged. */
  original: string;
  /** What to write instead, or null when the fix needs a human. */
  replacement: string | null;
  /** Character offsets into the analysed content (end is exclusive). */
  start: number;
  end: number;
  severity: CheckSeverity;
}

export interface WritingStats {
  characters: number;
  words: number;
  sentences: number;
  paragraphs: number;
  readingTimeMinutes: number;
  avgSentenceWords: number;
  longestSentenceWords: number;
}

export interface WritingTone {
  label: "Confident" | "Neutral" | "Hesitant" | "Critical" | "Warm";
  confidence: number;
}

export interface WritingCheckResult {
  suggestions: WritingSuggestion[];
  stats: WritingStats;
  /** 0–100, starts at 100 and is docked by the issues found + readability. */
  score: number;
  grade: "A" | "B" | "C" | "D";
  tone: WritingTone;
  counts: Record<CheckKind, number>;
}

/* ------------------------------------------------------------------ */
/*  Rule tables                                                        */
/* ------------------------------------------------------------------ */

interface WordRule {
  rule: string;
  kind: CheckKind;
  severity: CheckSeverity;
  pattern: RegExp;
  replace: string;
  message: string;
}

/**
 * Wordiness and redundant pairs. These are mechanical: the replacement means
 * the same thing, and the writer can always reject it. Every pattern is
 * word-bounded so "prior" inside "priority" never matches.
 */
const WORDY_RULES: WordRule[] = [
  { rule: "wordy.in-order-to", kind: "clarity", severity: "medium", pattern: /\bin order to\b/gi, replace: "to", message: "“in order to” can just be “to”." },
  { rule: "wordy.due-to-the-fact", kind: "clarity", severity: "medium", pattern: /\bdue to the fact that\b/gi, replace: "because", message: "“due to the fact that” is a clause-length way to say “because”." },
  { rule: "wordy.at-this-point-in-time", kind: "clarity", severity: "medium", pattern: /\bat (?:this|the present) (?:point in time|time)\b/gi, replace: "now", message: "“at this point in time” can be “now”." },
  { rule: "wordy.in-the-event-that", kind: "clarity", severity: "medium", pattern: /\bin the event that\b/gi, replace: "if", message: "“in the event that” is “if”." },
  { rule: "wordy.prior-to", kind: "clarity", severity: "low", pattern: /\bprior to\b/gi, replace: "before", message: "“prior to” reads more simply as “before”." },
  { rule: "wordy.a-large-number-of", kind: "clarity", severity: "low", pattern: /\ba (?:large|great) number of\b/gi, replace: "many", message: "“a large number of” can be “many”." },
  { rule: "wordy.in-spite-of-the-fact", kind: "clarity", severity: "medium", pattern: /\b(?:in spite of|despite) the fact that\b/gi, replace: "although", message: "Drop the throat-clearing: “although”." },
  { rule: "wordy.for-the-purpose-of", kind: "clarity", severity: "low", pattern: /\bfor the purpose of\b/gi, replace: "to", message: "“for the purpose of” can be “to”." },
  { rule: "wordy.with-regard-to", kind: "clarity", severity: "low", pattern: /\bwith (?:regard|regards|respect) to\b/gi, replace: "about", message: "“with regard to” is “about”." },
  { rule: "wordy.utilize", kind: "clarity", severity: "low", pattern: /\butili[sz]e\b/gi, replace: "use", message: "“utilize” is a longer “use”." },
  { rule: "wordy.commence", kind: "clarity", severity: "low", pattern: /\bcommence(?:s|d)?\b/gi, replace: "start", message: "“commence” reads as “start”." },
  { rule: "wordy.ascertain", kind: "clarity", severity: "low", pattern: /\bascertain(?:s|ed)?\b/gi, replace: "find out", message: "“ascertain” is “find out”." },
  { rule: "redundant.absolutely-essential", kind: "clarity", severity: "medium", pattern: /\babsolutely essential\b/gi, replace: "essential", message: "“essential” is already absolute." },
  { rule: "redundant.basic-fundamentals", kind: "clarity", severity: "medium", pattern: /\bbasic fundamentals\b/gi, replace: "fundamentals", message: "Fundamentals are basic by definition." },
  { rule: "redundant.end-result", kind: "clarity", severity: "medium", pattern: /\bend result\b/gi, replace: "result", message: "“result” is already the end." },
  { rule: "redundant.past-history", kind: "clarity", severity: "medium", pattern: /\bpast history\b/gi, replace: "history", message: "History is already past." },
  { rule: "redundant.future-plans", kind: "clarity", severity: "medium", pattern: /\bfuture plans\b/gi, replace: "plans", message: "Plans are already about the future." },
  { rule: "redundant.each-and-every", kind: "clarity", severity: "medium", pattern: /\beach and every\b/gi, replace: "every", message: "“each and every” says one thing twice." },
  { rule: "redundant.close-proximity", kind: "clarity", severity: "low", pattern: /\bclose proximity\b/gi, replace: "proximity", message: "Proximity already means closeness." },
  { rule: "redundant.new-innovation", kind: "clarity", severity: "low", pattern: /\b(?:new|brand new) innovation\b/gi, replace: "innovation", message: "An innovation is new by definition." },
  { rule: "redundant.final-outcome", kind: "clarity", severity: "low", pattern: /\bfinal outcome\b/gi, replace: "outcome", message: "An outcome is already final." },
];

/** Fixed misspellings — the ones spellcheckers miss and writers repeat. */
const SPELLING_RULES: WordRule[] = [
  { rule: "spelling.recieve", kind: "correctness", severity: "high", pattern: /\brecieve\b/gi, replace: "receive", message: "Spelling: “receive”." },
  { rule: "spelling.seperate", kind: "correctness", severity: "high", pattern: /\bseperate\b/gi, replace: "separate", message: "Spelling: “separate”." },
  { rule: "spelling.definately", kind: "correctness", severity: "high", pattern: /\bdefinately\b/gi, replace: "definitely", message: "Spelling: “definitely”." },
  { rule: "spelling.occured", kind: "correctness", severity: "high", pattern: /\boccured\b/gi, replace: "occurred", message: "Spelling: “occurred”." },
  { rule: "spelling.occurence", kind: "correctness", severity: "high", pattern: /\boccurence\b/gi, replace: "occurrence", message: "Spelling: “occurrence”." },
  { rule: "spelling.acheive", kind: "correctness", severity: "high", pattern: /\bacheive\b/gi, replace: "achieve", message: "Spelling: “achieve”." },
  { rule: "spelling.accomodate", kind: "correctness", severity: "high", pattern: /\baccomodate\b/gi, replace: "accommodate", message: "Spelling: “accommodate”." },
  { rule: "spelling.guarentee", kind: "correctness", severity: "high", pattern: /\bguarentee\b/gi, replace: "guarantee", message: "Spelling: “guarantee”." },
  { rule: "spelling.neccessary", kind: "correctness", severity: "high", pattern: /\bneccessary\b/gi, replace: "necessary", message: "Spelling: “necessary”." },
  { rule: "spelling.independant", kind: "correctness", severity: "high", pattern: /\bindependant\b/gi, replace: "independent", message: "Spelling: “independent”." },
  { rule: "spelling.sucessful", kind: "correctness", severity: "high", pattern: /\bsucessful\b/gi, replace: "successful", message: "Spelling: “successful”." },
  { rule: "spelling.begining", kind: "correctness", severity: "high", pattern: /\bbegining\b/gi, replace: "beginning", message: "Spelling: “beginning”." },
  { rule: "spelling.calender", kind: "correctness", severity: "high", pattern: /\bcalender\b/gi, replace: "calendar", message: "Spelling: “calendar”." },
  { rule: "spelling.comittee", kind: "correctness", severity: "high", pattern: /\bcomittee\b/gi, replace: "committee", message: "Spelling: “committee”." },
  { rule: "spelling.existance", kind: "correctness", severity: "high", pattern: /\bexistance\b/gi, replace: "existence", message: "Spelling: “existence”." },
  { rule: "spelling.publically", kind: "correctness", severity: "high", pattern: /\bpublically\b/gi, replace: "publicly", message: "Spelling: “publicly”." },
  { rule: "spelling.recomend", kind: "correctness", severity: "high", pattern: /\brecomend\b/gi, replace: "recommend", message: "Spelling: “recommend”." },
  { rule: "spelling.wierd", kind: "correctness", severity: "high", pattern: /\bwierd\b/gi, replace: "weird", message: "Spelling: “weird”." },
  { rule: "spelling.exagerate", kind: "correctness", severity: "high", pattern: /\bexagerate\b/gi, replace: "exaggerate", message: "Spelling: “exaggerate”." },
  { rule: "spelling.untill", kind: "correctness", severity: "high", pattern: /\buntill\b/gi, replace: "until", message: "Spelling: “until”." },
  { rule: "spelling.tommorow", kind: "correctness", severity: "high", pattern: /\btommorow\b/gi, replace: "tomorrow", message: "Spelling: “tomorrow”." },
  { rule: "spelling.alot", kind: "correctness", severity: "high", pattern: /\balot\b/gi, replace: "a lot", message: "“a lot” is two words." },
];

/** Hedges and filler — advice only, because cutting them changes emphasis. */
const HEDGE_PATTERNS: { rule: string; pattern: RegExp; severity: CheckSeverity; message: string }[] = [
  { rule: "filler.very", pattern: /\bvery\b/gi, severity: "low", message: "“very” weakens the word it modifies — pick a stronger one or drop it." },
  { rule: "filler.really", pattern: /\breally\b/gi, severity: "low", message: "“really” is filler; the verb usually carries enough." },
  { rule: "filler.basically", pattern: /\bbasically\b/gi, severity: "low", message: "“basically” hedges a claim you probably mean." },
  { rule: "filler.actually", pattern: /\bactually\b/gi, severity: "low", message: "“actually” is usually removable." },
  { rule: "filler.quite", pattern: /\bquite\b/gi, severity: "low", message: "“quite” softens the sentence without adding meaning." },
];

/** Clichés — engagement advice, no automatic rewrite. */
const CLICHE_PATTERNS: { rule: string; pattern: RegExp; message: string }[] = [
  { rule: "cliche.at-the-end-of-the-day", pattern: /\bat the end of the day\b/gi, message: "Cliché — say what you actually mean." },
  { rule: "cliche.think-outside-the-box", pattern: /\bthink outside the box\b/gi, message: "Cliché — describe the unusual approach instead." },
  { rule: "cliche.low-hanging-fruit", pattern: /\blow[- ]hanging fruit\b/gi, message: "Cliché — name the easy win." },
  { rule: "cliche.game-changer", pattern: /\bgame[- ]changer\b/gi, message: "Cliché — say what changed and for whom." },
  { rule: "cliche.tip-of-the-iceberg", pattern: /\btip of the iceberg\b/gi, message: "Cliché — quantify what is underneath." },
  { rule: "cliche.in-todays-world", pattern: /\bin today'?s (?:world|fast-paced world|digital age)\b/gi, message: "Throat-clearing opener — lead with the point." },
];

const POSITIVE_WORDS = /\b(?:growth|wins?|winning|success|thrive|thriving|breakthrough|opportunity|proud|celebrate|boost|bright|strong|progress|hope|promise|record|milestone|innovation|resilient)\b/gi;
const NEGATIVE_WORDS = /\b(?:crisis|fail(?:ure|ed|s)?|loss(?:es)?|declin(?:e|ed|ing)|threat|risk|problem|problems|collapse|worry|worried|fear|shortage|debt|corrupt(?:ion)?|attack|layoffs?|shutdown|struggl(?:e|ed|ing))\b/gi;
const HEDGE_WORDS = /\b(?:maybe|perhaps|possibly|might|could|seems?|appears?|somewhat|arguably|potentially|likely)\b/gi;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Preserve the author's capitalisation when swapping a matched phrase. */
function matchCase(original: string, replacement: string): string {
  if (!original) return replacement;
  const first = original[0]!;
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Split prose into sentences without pulling in a tokenizer. */
function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Find every match of a rule and turn it into a suggestion. */
function collectRule(content: string, rule: WordRule): WritingSuggestion[] {
  const out: WritingSuggestion[] = [];
  // Fresh regex per call: a shared /g/ regex keeps `lastIndex` between runs.
  const re = new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : rule.pattern.flags + "g");
  for (const match of content.matchAll(re)) {
    const original = match[0];
    const start = match.index ?? 0;
    out.push({
      id: `${rule.rule}:${start}`,
      kind: rule.kind,
      rule: rule.rule,
      message: rule.message,
      original,
      replacement: matchCase(original, rule.replace),
      start,
      end: start + original.length,
      severity: rule.severity,
    });
  }
  return out;
}

/** Drop suggestions whose ranges overlap, keeping the earlier/longer one. */
function dedupe(suggestions: WritingSuggestion[]): WritingSuggestion[] {
  const sorted = [...suggestions].sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: WritingSuggestion[] = [];
  for (const s of sorted) {
    const clash = kept.some((k) => s.start < k.end && k.start < s.end);
    if (!clash) kept.push(s);
  }
  return kept;
}

export function readingStats(content: string): WritingStats {
  const words = countWords(content);
  const sentences = splitSentences(content);
  const sentenceWordCounts = sentences.map((s) => countWords(s));
  const paragraphs = content.split(/\n{2,}/).filter((p) => p.trim()).length;
  return {
    characters: content.length,
    words,
    sentences: sentences.length,
    paragraphs,
    readingTimeMinutes: Math.max(1, Math.ceil(words / 200)),
    avgSentenceWords: sentences.length ? Math.round((words / sentences.length) * 10) / 10 : 0,
    longestSentenceWords: sentenceWordCounts.length ? Math.max(...sentenceWordCounts) : 0,
  };
}

/** Where sentiment sits: a light lexicon is enough to label a draft's tone. */
function detectTone(content: string): WritingTone {
  const positive = [...content.matchAll(POSITIVE_WORDS)].length;
  const negative = [...content.matchAll(NEGATIVE_WORDS)].length;
  const hedges = [...content.matchAll(HEDGE_WORDS)].length;
  const total = positive + negative + hedges;
  if (total === 0) return { label: "Neutral", confidence: 0.2 };
  if (hedges >= positive && hedges >= negative && hedges > 0) {
    return { label: "Hesitant", confidence: Math.min(0.9, hedges / Math.max(1, total)) };
  }
  if (negative > positive) return { label: "Critical", confidence: Math.min(0.9, negative / total) };
  if (positive > 0) {
    const label: WritingTone["label"] = positive >= negative * 2 && positive > 3 ? "Warm" : "Confident";
    return { label, confidence: Math.min(0.9, positive / total) };
  }
  return { label: "Neutral", confidence: 0.3 };
}

/** Turn a 0–100 number into the letter a reader recognises. */
function gradeFor(score: number): WritingCheckResult["grade"] {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

/* ------------------------------------------------------------------ */
/*  Entry point                                                        */
/* ------------------------------------------------------------------ */

/**
 * Analyse a draft and return every issue as a range, newest rules first.
 *
 * Pure and side-effect free: the caller debounces and posts it, tests pin it,
 * and nothing here touches the network or the database.
 */
export function runWritingChecks(content: string): WritingCheckResult {
  const text = typeof content === "string" ? content : "";
  const suggestions: WritingSuggestion[] = [];

  for (const rule of SPELLING_RULES) suggestions.push(...collectRule(text, rule));
  for (const rule of WORDY_RULES) suggestions.push(...collectRule(text, rule));

  // Doubled words ("the the", "and and").
  for (const match of text.matchAll(/\b([A-Za-z']+)(\s+)\1\b/g)) {
    const original = match[0];
    const start = match.index ?? 0;
    if (original.length > 24) continue;
    suggestions.push({
      id: `mechanics.doubled-word:${start}`,
      kind: "correctness",
      rule: "mechanics.doubled-word",
      message: "Doubled word.",
      original,
      replacement: match[1]!,
      start,
      end: start + original.length,
      severity: "medium",
    });
  }

  // Runs of spaces inside a line (never across a newline, which is markdown).
  for (const match of text.matchAll(/[^\S\n]{2,}/g)) {
    const original = match[0];
    const start = match.index ?? 0;
    suggestions.push({
      id: `mechanics.double-space:${start}`,
      kind: "correctness",
      rule: "mechanics.double-space",
      message: "Extra spaces.",
      original,
      replacement: " ",
      start,
      end: start + original.length,
      severity: "low",
    });
  }

  // A space before punctuation.
  for (const match of text.matchAll(/\s+([,.;:!?])/g)) {
    const original = match[0];
    const start = match.index ?? 0;
    suggestions.push({
      id: `mechanics.space-before-punctuation:${start}`,
      kind: "correctness",
      rule: "mechanics.space-before-punctuation",
      message: "Remove the space before punctuation.",
      original,
      replacement: match[1]!,
      start,
      end: start + original.length,
      severity: "medium",
    });
  }

  // Advice-only rules: hedges and clichés.
  for (const rule of HEDGE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(rule.pattern.source, "gi"))) {
      const original = match[0];
      const start = match.index ?? 0;
      suggestions.push({
        id: `${rule.rule}:${start}`,
        kind: "clarity",
        rule: rule.rule,
        message: rule.message,
        original,
        replacement: null,
        start,
        end: start + original.length,
        severity: rule.severity,
      });
    }
  }
  for (const rule of CLICHE_PATTERNS) {
    for (const match of text.matchAll(new RegExp(rule.pattern.source, "gi"))) {
      const original = match[0];
      const start = match.index ?? 0;
      suggestions.push({
        id: `${rule.rule}:${start}`,
        kind: "engagement",
        rule: rule.rule,
        message: rule.message,
        original,
        replacement: null,
        start,
        end: start + original.length,
        severity: "low",
      });
    }
  }

  // Long sentences — advice, because splitting is an editorial choice. The
  // offset points at the whole sentence so the composer can highlight it.
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const at = text.indexOf(sentence, cursor);
    const start = at >= 0 ? at : cursor;
    cursor = start + sentence.length;
    const words = countWords(sentence);
    if (words > 32) {
      suggestions.push({
        id: `readability.long-sentence:${start}`,
        kind: "clarity",
        rule: "readability.long-sentence",
        message: `Long sentence (${words} words) — consider splitting it.`,
        original: sentence,
        replacement: null,
        start,
        end: start + sentence.length,
        severity: words > 45 ? "medium" : "low",
      });
    }
  }

  const deduped = dedupe(suggestions);
  const stats = readingStats(text);

  const penalty = deduped.reduce(
    (sum, s) => sum + (s.severity === "high" ? 6 : s.severity === "medium" ? 3 : 1),
    0
  );
  // Readability nudge: very long average sentences cost a little, and a draft
  // with no sentence variety reads flat. Capped so readability can never
  // dominate the mechanical issues.
  const readabilityPenalty =
    stats.sentences >= 3 && stats.avgSentenceWords > 26
      ? Math.min(8, Math.round(stats.avgSentenceWords - 26))
      : 0;

  const score = Math.max(40, Math.min(100, 100 - penalty - readabilityPenalty));
  const counts: Record<CheckKind, number> = { correctness: 0, clarity: 0, engagement: 0, style: 0 };
  for (const s of deduped) counts[s.kind] += 1;

  return { suggestions: deduped, stats, score, grade: gradeFor(score), tone: detectTone(text), counts };
}

/**
 * Apply a suggestion's replacement to a draft, keeping every other offset
 * valid. Returns the new content; a suggestion with no replacement is a no-op,
 * so callers can pass anything safely.
 */
export function applySuggestion(content: string, suggestion: WritingSuggestion): string {
  if (suggestion.replacement === null) return content;
  if (suggestion.start < 0 || suggestion.end > content.length || suggestion.start >= suggestion.end) {
    return content;
  }
  return content.slice(0, suggestion.start) + suggestion.replacement + content.slice(suggestion.end);
}

/**
 * Apply several suggestions at once by working back-to-front, so an earlier
 * edit can never shift a later one's offsets.
 */
export function applySuggestions(content: string, suggestions: WritingSuggestion[]): string {
  const ordered = suggestions
    .filter((s) => s.replacement !== null)
    .slice()
    .sort((a, b) => b.start - a.start);
  let next = content;
  for (const s of ordered) next = applySuggestion(next, s);
  return next;
}
