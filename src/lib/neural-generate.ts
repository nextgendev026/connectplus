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

  const score = Math.max(20, 100 - penalty);
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

// ── Phase 3/4: the writing brain ────────────────────────────────────────────
// Deterministic "copilot" operations shared by the admin Neural Chat and the
// studio's Brain Copilot. Everything is a pure function of the input text, so
// the same brain powers both surfaces.

export interface PolishResult {
  original: string;
  rewritten: string;
  changes: number;
  notes: string[];
}

const FILLERS_TO_CUT = new Set([
  "very", "really", "actually", "basically", "just", "quite", "literally",
  "simply", "pretty", "rather", "totally", "absolutely", "so", "just",
  "obviously", "definitely", "certainly", "truly", "honestly",
]);

const HEDGES_TO_CUT = new Set([
  "maybe", "perhaps", "possibly", "probably", "seems", "seem", "kind of",
  "sort of", "somewhat", "i think", "i feel", "i believe", "i guess",
]);

function splitLongSentence(sentence: string): string[] {
  const words = sentence.split(/\s+/);
  if (words.length <= 45) return [sentence];
  // Prefer splitting at a conjunction near the middle.
  const mid = Math.floor(words.length / 2);
  const candidates = [
    [" and ", " but ", " so ", " because ", " which ", " that ", "; "],
  ][0]!;
  let bestIdx = -1;
  let bestDist = words.length;
  for (let i = 10; i < words.length - 10; i++) {
    const w = words[i]!.toLowerCase();
    const isSplit = candidates.some((c) => w.includes(c.trim()) || (w === c.trim() && c.trim().length > 0));
    if (isSplit && Math.abs(i - mid) < bestDist) {
      bestDist = Math.abs(i - mid);
      bestIdx = i;
    }
  }
  if (bestIdx > 0) {
    const left = words.slice(0, bestIdx).join(" ").replace(/[,;]\s*$/, "");
    const right = words.slice(bestIdx).join(" ");
    return [left, right.charAt(0).toUpperCase() + right.slice(1)];
  }
  // Fall back: cut at the mid word boundary.
  const left = words.slice(0, mid).join(" ").replace(/[,;]\s*$/, "");
  const right = words.slice(mid).join(" ");
  return [left, right.charAt(0).toUpperCase() + right.slice(1)];
}

function stripFillerWords(text: string): { out: string; removed: string[] } {
  const words = text.split(/(\s+)/);
  const removed: string[] = [];
  const out = words
    .map((tok) => {
      const w = tok.toLowerCase().replace(/[^a-z']/g, "");
      if ((FILLERS_TO_CUT.has(w) || HEDGES_TO_CUT.has(w)) && tok.trim().length > 0) {
        removed.push(tok.trim());
        return "";
      }
      return tok;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
  return { out, removed };
}

/**
 * Deterministic rewrite pass: cuts filler + hedging, splits marathon sentences,
 * and converts common passive constructions to active voice. Returns the
 * polished draft plus a human-readable change log.
 */
export function polishText(rawContent: string): PolishResult {
  const text = stripHtml(rawContent).trim();
  if (text.length === 0) {
    return { original: text, rewritten: text, changes: 0, notes: [] };
  }

  let working = text;
  const notes: string[] = [];

  // 1. Cut filler + hedge words.
  const filler = stripFillerWords(working);
  if (filler.removed.length > 0) {
    working = filler.out;
    notes.push(`Removed ${filler.removed.length} filler/hedging word${filler.removed.length > 1 ? "s" : ""} (${[...new Set(filler.removed)].slice(0, 5).join(", ")}).`);
  }

  // 2. Split marathon sentences.
  const sentences = working.split(/(?<=[.!?])\s+/);
  const splitOut: string[] = [];
  let splits = 0;
  for (const s of sentences) {
    const parts = splitLongSentence(s);
    if (parts.length > 1) splits += 1;
    splitOut.push(...parts);
  }
  if (splits > 0) {
    working = splitOut.join(" ");
    notes.push(`Split ${splits} over-long sentence${splits > 1 ? "s" : ""} into shorter, punchier ones.`);
  }

  // 3. Passive → active for common constructions.
  const active = working.replace(
    /\b(was|were|is|are|been)\s+(\w+ed)\s+by\s+(the\s+)?([a-z][a-z ]{1,24}?)(?=[\.,;!?\s]|$)/gi,
    (_m, _be, verb, _the, agent) => {
      const subject = agent.trim().replace(/\s+/g, " ");
      if (!subject) return _m;
      return `${capitalize(subject)} ${verb}`;
    }
  );
  if (active !== working) {
    notes.push("Converted passive constructions to active voice for momentum.");
    working = active;
  }

  working = working.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();

  const changes =
    notes.length +
    Math.abs(working.split(/\s+/).length - text.split(/\s+/).length);
  return {
    original: text,
    rewritten: working,
    changes,
    notes,
  };
}

/** Pick a template variant deterministically from a seed so answers vary. */
export function pickVariant(templates: string[], seed: string): string {
  if (templates.length === 0) return "";
  // FNV-1a: spreads seed strings well so different inputs pick different variants.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return templates[h % templates.length]!;
}

/**
 * Continue writing: drafts a flowing next paragraph anchored to the last
 * sentence's topic/keywords so it reads like a natural extension.
 */
export function continueText(rawContent: string): { continuation: string; heading?: string } {
  const text = stripHtml(rawContent).trim();
  const kws = extractKeywords(text, 4).map((k) => k.keyword);
  const entities = extractEntities(text);
  const lastSentence =
    text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10).pop()?.trim() ?? text;
  const topic = kws[0] ?? entities[0]?.value?.split(" ")[0] ?? "the story";
  const second = kws[1] ?? (entities[1]?.value?.split(" ")[0] ?? "the community");
  const place = entities.find((e) => e.type === "place")?.value ?? "across East Africa";

  const openers = [
    `What makes this worth watching is what comes next. The momentum around ${topic} is not slowing down — ${second} are paying attention in new ways, and ${place} is already feeling the shift.`,
    `Dig deeper and the picture sharpens. Beyond the headlines, ${topic} is reshaping how ${second} think about the future — and the ripple effects are just beginning to show ${place}.`,
    `The bigger question is where this leads. If the energy behind ${topic} keeps building, ${second} will have to respond — and ${place} stands to gain the most from what happens next.`,
  ];

  const continuations = [
    `Take the numbers: engagement around ${topic} keeps climbing week after week. Creators who lean into ${second} are seeing real returns, and the pattern is consistent enough to plan around. The smart play is to document the change while it is happening, not after.`,
    `For anyone following closely, the signal is clear: ${topic} is becoming a defining theme for ${place}. The question is no longer whether it matters, but who will own the conversation first. That is an opportunity worth acting on.`,
    `Look at the way the story has already moved. What started as a niche interest is now part of the everyday conversation in ${place}. The next chapter belongs to whoever brings fresh angles on ${topic} — and there is still room for a genuinely new voice.`,
  ];

  const heading = pickVariant(
    [
      `## Why ${capitalize(topic)} matters more than ever`,
      `## The momentum behind ${capitalize(topic)}`,
      `## What ${capitalize(second)} should watch next`,
      `## Where ${capitalize(topic)} goes from here`,
    ],
    text.slice(-80)
  );

  const seed = `${lastSentence} ${kws.join(" ")}`;
  return {
    continuation: `${pickVariant(openers, seed)} ${pickVariant(continuations, seed + "c")}`,
    heading,
  };
}

/** Build a structured outline for a post about a topic or from draft content. */
export function buildOutline(rawContentOrTopic: string): { intro: string; sections: string[]; closing: string } {
  const kws = extractKeywords(rawContentOrTopic, 5).map((k) => k.keyword);
  const entities = extractEntities(rawContentOrTopic);
  const topic = kws[0] ?? entities[0]?.value?.split(" ")[0] ?? "the story";
  const angle = kws[1] ?? "the people behind it";
  const place = entities.find((e) => e.type === "place")?.value ?? "East Africa";
  const org = entities.find((e) => e.type === "organization")?.value;

  const intro = `Open with a scene or a number that makes ${topic} feel immediate — why it matters to readers in ${place} right now, and what changed recently.`;
  const sections = [
    `## The current state of ${capitalize(topic)}`,
    `## What ${capitalize(angle)} tells us`,
    org ? `## Inside ${org}: the players to watch` : `## The people driving ${capitalize(topic)} forward`,
    `## Challenges nobody is talking about`,
    `## What happens next — and how readers can stay ahead`,
  ];
  const closing = `End with a forward-looking take: the one thing that would change the picture for ${topic} in the next six months, and a question that invites readers to share their own experience.`;
  return { intro, sections, closing };
}

/** Compose a complete short-form draft from a topic (write-from-scratch brain). */
export function composeDraft(rawTopic: string): { draft: string; headline: string; tags: string[] } {
  const kws = extractKeywords(rawTopic, 5).map((k) => k.keyword);
  const entities = extractEntities(rawTopic);
  const topic = kws[0] ?? entities[0]?.value?.split(" ")[0] ?? "the story";
  const angle = kws[1] ?? (entities[1]?.value?.split(" ")[0] ?? "creators");
  const place = entities.find((e) => e.type === "place")?.value ?? "East Africa";
  const headline = pickVariant(
    [
      `${capitalize(topic)}: the story shaping ${place} right now`,
      `Inside ${capitalize(topic)} — what ${angle} need to know`,
      `How ${capitalize(topic)} is changing the game ${place}`,
      `${capitalize(topic)} explained: a field guide for ${angle}`,
    ],
    rawTopic
  );
  const tags = [...new Set([...kws.slice(0, 5), ...entities.slice(0, 2).map((e) => e.value.toLowerCase().split(" ")[0]!), "Africa"].map((t) => t.toLowerCase()))].slice(0, 8);

  const draft = [
    `There is a quiet shift happening around ${topic}, and ${place} is at the centre of it. What started as a handful of conversations is becoming a movement — and the people closest to it are already changing how the region thinks about ${angle}.`,
    "",
    `## The state of play`,
    `To understand ${topic}, start with the people. ${capitalize(angle)} are experimenting, comparing notes and building on each other's wins in ways that were impossible a few years ago. The result is a faster feedback loop between ideas and outcomes.`,
    "",
    `## What is driving it`,
    `Three forces are pushing ${topic} forward: demand from a younger, mobile-first audience; lower barriers to entry for new voices; and a growing willingness to back local ideas with local capital. Together they are compounding.`,
    "",
    `## The gap nobody is filling`,
    `For all the momentum, the conversation is still missing depth. Most coverage recycles press releases instead of reporting on the ground. That is where the opportunity lives — original, specific, human stories about ${topic} in ${place}.`,
    "",
    `## Where it goes next`,
    `Watch the next six months. If the current trajectory holds, ${topic} will move from a niche interest to a mainstream talking point ${place}. The creators who start documenting it now will own the narrative.`,
    "",
    `*What is your experience with ${topic}? Share your story in the comments — the best perspectives come from readers like you.*`,
  ].join("\n");

  return { draft, headline, tags };
}

/** Strip a leading instruction ("rewrite this:", "write about", …) from chat text. */
export function stripInstruction(input: string): string {
  let text = input.trim();
  const prefix =
    /^(?:please\s+)?(?:can\s+you\s+)?(?:rewrite|rephrase|polish|improve|summarize|summarise|condense|expand|continue|extend|write|compose|create|draft|generate|make|give\s+me|suggest)\s*(?:this|about|(?:my|your|the|this)\s+(?:draft|post|article|story|text|paragraph|content|piece|following))?\s*(?:for\s+me)?\s*[\-—–:]?\s*/i;
  text = text.replace(prefix, "").trim();
  return text;
}