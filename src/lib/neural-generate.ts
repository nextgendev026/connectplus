import {
  extractKeywords,
  analyzeSentiment,
  extractEntities,
  summarizeText,
  stripHtml,
} from "@/lib/neural-text";

export type GenerateType = "headline" | "excerpt" | "topics";

export interface GenerateResult {
  type: GenerateType;
  primary: string;
  alternatives: string[];
  source: "ai" | "fallback";
  model: string;
}

const TEMPLATE_VERBS = [
  "reveals", "unveils", "announces", "pushes", "charts", "targets", "doubles down on",
  "moves to", "commits to", "celebrates", "confronts", "navigates", "fuels", "sparks",
  "eyes", "secures", "launches", "rates", "weighs",
];

/** Deterministic AI-style headline generator (extractive + templated). */
export function generateHeadline(title: string, content: string): GenerateResult {
  const cleanTitle = title.trim().replace(/\s+/g, " ");
  const words = content.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4);
  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 8);

  const nouns = ["plans", "strategy", "growth", "milestone", "progress", "reform", "partnership", "investment", "expansion"];
  const entities = extractEntities(`${title} ${content}`).filter((e) => e.type !== "event");
  const entityName = entities[0]?.value?.split(" ").slice(0, 3).join(" ") ?? null;

  const candidates: string[] = [];

  if (ranked.length >= 3) {
    const a = ranked[0]!;
    const b = ranked[1]!;
    const c = ranked[2] ?? "milestone";
    candidates.push(cleanTitle.length <= 60 ? `${cleanTitle}: The ${b} and ${c} factor` : cleanTitle);
    candidates.push(`${cleanTitle} — inside the ${b} story`);
    candidates.push(`How ${b} is shaping ${a}${entityName ? ` for ${entityName.split(" ")[0] ?? ""}` : ""}`);
    if (entityName) candidates.push(`${entityName}: ${capitalize(a)} ${c}`);
  }

  // Template-based fallbacks using title tokens.
  const t0 = tokens(cleanTitle)[0];
  const topic = ranked[0] ?? t0 ?? "Africa";
  const verb = TEMPLATE_VERBS[hash(cleanTitle) % TEMPLATE_VERBS.length] ?? "charts";
  const noun = nouns[hash(`${topic}${verb}`) % nouns.length] ?? "growth";
  candidates.push(`Kenya ${verb} ${topic} as ${noun} accelerates`);
  candidates.push(`${capitalize(topic)}: the ${noun} story no one is telling`);
  if (entityName) candidates.push(`Why ${entityName} just became the story`);
  candidates.push(`The big ${noun}: what ${t0 ?? "leaders"} got right this week`);

  const unique = [...new Set(candidates.filter(Boolean))].slice(0, 4);
  return { type: "headline", primary: unique[0] ?? cleanTitle, alternatives: unique.slice(1), source: "ai", model: "extractive-templated-kw" };
}

function capitalize(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function tokens(title: string): string[] {
  return title.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic excerpt generation (extractive summary at ~28 words). */
export function generateExcerpt(title: string, content: string): GenerateResult {
  const text = stripHtml(content);
  const summary = summarizeText(text, 2);

  const firstSentences = text
    .split(/[.!?]+(?:\s|$)/)
    .filter((s) => s.trim().length > 12)
    .map((s) => s.trim())
    .slice(0, 2)
    .join(". ");

  const primary = summarizeText(summary || firstSentences, 1).slice(0, 280) || title;
  const alt1 = summarizeText(text, 2).slice(0, 280);
  const alt2 = (firstSentences || summary).slice(0, 280);

  const alternatives = [...new Set([alt1, alt2].filter((a) => a && a !== primary))].slice(0, 2);
  return { type: "excerpt", primary, alternatives, source: "ai", model: "extractive-summarizer" };
}

/** Deterministic topic/tag generation from keywords + entities. */
export function generateTopics(content: string): GenerateResult {
  const text = stripHtml(content);
  const kws = extractKeywords(text, 5);
  const entities = extractEntities(text);

  const topics: string[] = [];
  topics.push(...kws.map((k) => k.keyword));
  topics.push(...entities.map((e) => e.value.split(" ").slice(0, 2).join(" ")));
  topics.push(...["Africa", "Kenya", "Development"]);

  const unique = [...new Set(topics.map((t) => t.toLowerCase()))].filter(Boolean).slice(0, 6);
  return {
    type: "topics",
    primary: unique[0] ?? "Africa",
    alternatives: unique.slice(1),
    source: "ai",
    model: "keyword-entity-topic",
  };
}

export interface AnalysisProfile {
  sentiment: ReturnType<typeof analyzeSentiment>;
  keywords: ReturnType<typeof extractKeywords>;
  entities: ReturnType<typeof extractEntities>;
}

export function analyzeContent(text: string): AnalysisProfile {
  return {
    sentiment: analyzeSentiment(text),
    keywords: extractKeywords(text, 8),
    entities: extractEntities(text),
  };
}

// ── Phase 2/4: readability & clarity enhancement ────────────────────────────

export interface EnhancementSuggestion {
  kind:
    | "long-sentence"
    | "weak-hook"
    | "passive-voice"
    | "adverb-overuse"
    | "filler-words"
    | "hedging"
    | "repetition"
    | "long-paragraph";
  message: string;
}

export interface EnhancementResult {
  /** 0-100 quality score (higher = cleaner draft). */
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  readability: {
    sentences: number;
    words: number;
    avgSentenceWords: number;
    longSentenceCount: number;
  };
  suggestions: EnhancementSuggestion[];
}

const FILLER = new Set([
  "very", "really", "actually", "basically", "just", "quite", "literally",
  "simply", "pretty", "rather", "totally", "absolutely", "so",
]);

const HEDGES = new Set([
  "maybe", "perhaps", "might", "possibly", "probably", "seems", "seem",
  "i think", "i feel", "kind of", "sort of", "somewhat",
]);

const PASSIVE_RE = /\b(?:is|are|was|were|be|been|being)\s+(?:\w+\s+){0,2}\w+ed\b/g;

/**
 * Deterministic grammar/clarity pass over a draft. Library-free and safe to
 * run anywhere — the "/api/ai/enhance" content-intelligence endpoint.
 */
export function enhanceText(rawContent: string): EnhancementResult {
  const text = stripHtml(rawContent);
  const sentences = text
    .split(/[.!?]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const words = text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/).filter(Boolean);

  const suggestions: EnhancementSuggestion[] = [];
  let penalty = 0;

  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 45).length;
  if (longSentences > 0) {
    penalty += Math.min(20, longSentences * 6);
    suggestions.push({
      kind: "long-sentence",
      message: `${longSentences} sentence${longSentences > 1 ? "s" : ""} exceed 45 words — split ${longSentences > 1 ? "them" : "it"} into shorter, punchier sentences.`,
    });
  }

  const hook = sentences[0];
  if (hook && hook.split(/\s+/).length > 35) {
    penalty += 8;
    suggestions.push({
      kind: "weak-hook",
      message: "Your opening sentence is 35+ words — readers decide in seconds, so lead with the sharpest detail first.",
    });
  } else if (hook && /^(in today'?s|this article|this post|welcome to|the following)/i.test(hook)) {
    penalty += 6;
    suggestions.push({
      kind: "weak-hook",
      message: "Avoid clichéd openers like \"In today's…\" — start with a concrete scene, number, or question.",
    });
  }

  const passive = text.match(PASSIVE_RE) ?? [];
  if (passive.length > 0) {
    penalty += Math.min(12, passive.length * 4);
    suggestions.push({
      kind: "passive-voice",
      message: `${passive.length} passive construction${passive.length > 1 ? "s" : ""} detected (e.g. \"${passive[0]}\") — prefer active voice for momentum.`,
    });
  }

  const adverbs = words.filter((w) => w.length > 5 && w.endsWith("ly")).length;
  if (adverbs > Math.max(3, words.length * 0.02)) {
    penalty += 8;
    suggestions.push({
      kind: "adverb-overuse",
      message: `${adverbs} -ly adverbs — cut most of them and let stronger verbs carry the sentence.`,
    });
  }

  const fillers = words.filter((w) => FILLER.has(w)).length;
  if (fillers > 0) {
    penalty += Math.min(10, fillers * 2);
    suggestions.push({
      kind: "filler-words",
      message: `${fillers} filler word${fillers > 1 ? "s" : ""} (very, really, actually, just…) — deleting them tightens your prose instantly.`,
    });
  }

  const lower = text.toLowerCase();
  const hedges = [...HEDGES].filter((h) => lower.includes(h)).length;
  if (hedges > 0) {
    penalty += Math.min(10, hedges * 3);
    suggestions.push({
      kind: "hedging",
      message: `Hedging language (${[...HEDGES].filter((h) => lower.includes(h)).slice(0, 3).join(", ")}…) softens your authority — state claims with confidence.`,
    });
  }

  const freq = new Map<string, number>();
  for (const w of words) if (w.length > 3) freq.set(w, (freq.get(w) ?? 0) + 1);
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && words.length >= 40 && top[1] / words.length > 0.06) {
    penalty += 8;
    suggestions.push({
      kind: "repetition",
      message: `\"${top[0]}\" appears ${top[1]} times (${Math.round((top[1] / words.length) * 100)}% of words) — vary your vocabulary.`,
    });
  }

  const paragraphs = text.split(/\n{2,}/);
  const longParagraphs = paragraphs.filter((p) => p.split(/\s+/).length > 120).length;
  if (longParagraphs > 0) {
    penalty += Math.min(10, longParagraphs * 4);
    suggestions.push({
      kind: "long-paragraph",
      message: `${longParagraphs} paragraph${longParagraphs > 1 ? "s" : ""} run ${longParagraphs > 1 ? "" : "s"} 120+ words — break ${longParagraphs > 1 ? "them" : "it"} up for mobile readers.`,
    });
  }

  const avgSentenceWords = sentences.length
    ? Math.round((words.length / sentences.length) * 10) / 10
    : 0;

  let score = Math.max(20, 100 - penalty);
  const grade: EnhancementResult["grade"] =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 45 ? "D" : "F";

  return {
    score,
    grade,
    readability: {
      sentences: sentences.length,
      words: words.length,
      avgSentenceWords,
      longSentenceCount: longSentences,
    },
    suggestions,
  };
}