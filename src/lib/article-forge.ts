/**
 * The Article Forge — writing a whole piece, not a fragment of one.
 *
 * The copilot could already answer "write about X", and the answer was cut off
 * mid-sentence. That is not a bug in the model: a 1,200-word article cannot come
 * out of one 700-token completion, and asking for it that way guarantees the
 * writer gets an introduction and a severed sentence. Finishing an article is a
 * *structural* problem, so this module treats it as one:
 *
 *   • **Plan first.** A piece gets a title, a meta description, a hook and a
 *     section list before a word of prose is written. Anything generated against
 *     a plan is already structured — which is most of what "SEO-ready" means.
 *   • **One section per call.** Each section is a bounded generation with its
 *     own word budget, so nothing is asked to fit a length it cannot.
 *   • **Check completion, not length.** Every returned chunk is inspected for
 *     the ways a completion actually gets cut — an unbalanced code fence, a
 *     dangling conjunction, no closing punctuation — and only a chunk that reads
 *     finished is accepted. A cut one is continued rather than published.
 *   • **Assemble, never concatenate.** Headings are ours, duplicate headings the
 *     model added are stripped, and a section that never arrived is reported
 *     instead of silently missing from the article.
 *
 * Everything here is pure except `forgeArticle`, which takes the generation
 * function as an argument. That split is deliberate: the prompts, the completion
 * rules and the assembly are all unit-testable without a provider, a network or
 * a database, and the same orchestrator runs on the server or in the browser.
 */

export interface ArticleRequest {
  /** What the piece is about — the writer's own words. */
  topic: string;
  /** The angle or the point of view, if the writer gave one. */
  angle?: string;
  category?: string;
  keywords?: string[];
  /** Roughly how long the finished piece should be. */
  targetWords?: number;
  tone?: string;
}

export interface ArticleSection {
  heading: string;
  /** What the section must cover — the beats the writer expects to find. */
  goal: string;
  targetWords: number;
}

export interface ArticlePlan {
  title: string;
  /** The search-result snippet, written to length. */
  metaDescription: string;
  /** The opening thought, before the first subheading. */
  hook: string;
  sections: ArticleSection[];
  /** Reader questions answered at the end — the FAQ block search engines read. */
  faq: string[];
  tags: string[];
  targetWords: number;
  /** True when the plan came from the model rather than the deterministic shape. */
  refined: boolean;
}

/** One generation request, in the only shape the forge needs a provider for. */
export interface ArticleGeneration {
  /** Which server-side system prompt to use. */
  kind: "article-outline" | "article-part" | "article-continue";
  prompt: string;
  maxTokens: number;
}

export type ArticleAsk = (request: ArticleGeneration) => Promise<string | null>;

export const MIN_ARTICLE_WORDS = 400;
export const MAX_ARTICLE_WORDS = 3_000;
export const DEFAULT_ARTICLE_WORDS = 1_200;

/** Bound a requested length to something a handful of calls can actually fill. */
export function clampTargetWords(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : DEFAULT_ARTICLE_WORDS;
  return Math.max(MIN_ARTICLE_WORDS, Math.min(MAX_ARTICLE_WORDS, n));
}

/** Everything quoted back into a prompt is bounded; a plan is not a payload. */
const MAX_TOPIC_CHARS = 300;
const MAX_HEADING_CHARS = 120;
const MAX_GOAL_CHARS = 400;

export function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Title-case a topic without destroying acronyms or proper nouns it already has. */
function titleCase(text: string): string {
  const small = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "of", "on", "or", "the", "to", "vs", "with"]);
  return text
    .split(" ")
    .map((word, i) => {
      if (word.length <= 3 && word === word.toUpperCase()) return word; // FKF, AI, API
      if (word !== word.toLowerCase()) return word; // already has case (Nairobi, Safaricom)
      const lower = word.toLowerCase();
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/**
 * The section shape every article gets, in order.
 *
 * A reader who bounces after the first screen should still have the story, which
 * is why "what happened" comes before "why it matters" and the forward-looking
 * section sits near the end. The list is the fallback for a plan the model could
 * not improve on — it is deliberately a *useful* article rather than a
 * placeholder, because with no provider configured this is what a writer gets.
 */
function defaultSectionShape(topic: string, category: string): { heading: string; goal: string }[] {
  const beat = topic || "the story";
  return [
    {
      heading: "The short version",
      goal: `State the news in ${beat} plainly in three or four sentences: what happened, who it affects, and the number or date that matters most.`,
    },
    {
      heading: "What actually happened",
      goal: `Give the concrete detail behind ${beat}: who did what, when, where, and the immediate consequences. No opinion yet.`,
    },
    {
      heading: "Why it matters",
      goal: `Explain the stakes in ${beat}${category ? ` for ${category} readers` : ""}: who gains, who loses, and what changes for ordinary people.`,
    },
    {
      heading: "What the numbers say",
      goal: `Bring one or two verifiable figures, ranges or comparisons into ${beat}. If no figure is certain, say what is unknown rather than inventing one.`,
    },
    {
      heading: "What happens next",
      goal: `Describe the most likely next steps, the timeline, and the one thing to watch that would change the picture.`,
    },
  ];
}

/**
 * Build a deterministic plan.
 *
 * Used directly when no provider is configured, and as the floor when the model's
 * outline cannot be parsed — a writer asking for an article must never receive
 * "something went wrong" instead of a structure.
 */
export function planArticle(request: ArticleRequest): ArticlePlan {
  const topic = clean(request.topic, MAX_TOPIC_CHARS) || "Untitled story";
  const category = clean(request.category, 60);
  const targetWords = clampTargetWords(request.targetWords);
  const shape = defaultSectionShape(topic, category);
  const perSection = Math.max(90, Math.round((targetWords * 0.8) / shape.length));

  return {
    title: titleCase(topic).slice(0, 90),
    metaDescription: clean(
      `${topic} — what happened, why it matters${category ? ` in ${category.toLowerCase()}` : ""}, and what to watch next.`,
      160
    ),
    hook: `Open on the single most important fact about ${topic.toLowerCase()}.`,
    sections: shape.map((s) => ({ heading: s.heading, goal: clean(s.goal, MAX_GOAL_CHARS), targetWords: perSection })),
    faq: [
      `What is the main takeaway about ${topic.toLowerCase()}?`,
      `Who is most affected?`,
      `What should readers watch next?`,
    ],
    tags: buildTags([topic, ...(request.keywords ?? []), category].filter(Boolean), 6),
    targetWords,
    refined: false,
  };
}

/** Tags from the topic and keywords: lowercase, hyphenated, deduplicated, capped. */
export function buildTags(values: string[], limit = 6): string[] {
  const out: string[] = [];
  for (const value of values) {
    for (const word of String(value).split(/[,\n]/)) {
      const tag = word
        .trim()
        .toLowerCase()
        .replace(/^#/, "")
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      if (tag.length < 2 || tag.length > 40) continue;
      if (out.includes(tag)) continue;
      out.push(tag);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Read a model's outline into a plan.
 *
 * `null` on anything unusable rather than a half-filled plan: a plan missing its
 * sections is worse than the deterministic one, because every later call would
 * be generating against a hole.
 */
export function parseArticleOutline(raw: string, request: ArticleRequest): ArticlePlan | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== "object") return null;
  const record = decoded as Record<string, unknown>;

  const targetWords = clampTargetWords(request.targetWords);
  const rawSections = Array.isArray(record.sections) ? record.sections : [];
  const sections: ArticleSection[] = [];
  for (const entry of rawSections) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const heading = clean(item.heading, MAX_HEADING_CHARS);
    if (!heading) continue;
    sections.push({
      heading,
      goal: clean(item.goal, MAX_GOAL_CHARS) || `Cover ${heading.toLowerCase()} with concrete detail.`,
      targetWords: 0,
    });
    if (sections.length >= 7) break;
  }
  if (sections.length < 2) return null;

  // The model picks the shape; the budget per section is arithmetic we own, so a
  // "5,000-word article" request cannot turn into seven thin sections.
  const perSection = Math.max(90, Math.round((targetWords * 0.8) / sections.length));
  for (const section of sections) section.targetWords = perSection;

  const faq = (Array.isArray(record.faq) ? record.faq : [])
    .map((q) => clean(q, 160))
    .filter(Boolean)
    .slice(0, 4);

  const fallback = planArticle(request);
  return {
    title: clean(record.title, 90) || fallback.title,
    metaDescription: clean(record.metaDescription, 160) || fallback.metaDescription,
    hook: clean(record.hook, 300) || fallback.hook,
    sections,
    faq: faq.length > 0 ? faq : fallback.faq,
    tags: buildTags(Array.isArray(record.tags) ? (record.tags as string[]) : fallback.tags, 8),
    targetWords,
    refined: true,
  };
}

/**
 * Is this prompt a request for a whole article?
 *
 * "Write about X" is a 1,200-word answer; "tighten this paragraph" is not. The
 * distinction decides which engine answers, and getting it wrong in the
 * permissive direction would hang a full forge off every casual instruction —
 * so both a writing verb and a publishing noun have to be present.
 */
export function isArticleRequest(prompt: string): { topic: string; targetWords: number } | null {
  const text = clean(prompt, 400);
  if (text.length < 10) return null;

  const verb = /\b(write|draft|create|generate|compose|prepare|produce|put together)\b/i;
  const noun = /\b(article|post|piece|story|feature|report|blog post|long read)\b/i;
  if (!verb.test(text) || !noun.test(text)) return null;

  const lengthMatch = /\b(\d{3,4})\s*(?:-|\s)?words?\b/i.exec(text);
  const targetWords = lengthMatch ? clampTargetWords(Number(lengthMatch[1])) : DEFAULT_ARTICLE_WORDS;

  const topic = text
    .replace(/^(please\s+)?(can you\s+|could you\s+|i need you to\s+|i want you to\s+)?/i, "")
    .replace(verb, " ")
    .replace(noun, " ")
    .replace(/\b(about|on|regarding|covering|exploring|explaining|reporting on)\b/i, " ")
    .replace(/\b(\d{3,4})\s*(?:-|\s)?words?\b/i, " ")
    .replace(/\b(long[- ]form|in[- ]depth|full|complete|entire|whole|seo[- ]optimis?ed|well[- ]structured|original)\b/gi, " ")
    .replace(/\s*[:–—,-]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (topic.length < 4) return null;
  return { topic, targetWords };
}

/* ── Did it actually finish? ─────────────────────────────────────────────── */

/**
 * The ways a completion gets cut.
 *
 * Length alone cannot tell you this: a 40-word paragraph that ends in a full
 * stop is finished, and a 400-word block that stops after "and" is not. These
 * are the observable symptoms, ordered so the most certain one is reported
 * first — an unclosed code fence is unambiguous, whereas punctuation is a
 * strong hint.
 */
export function completionIssues(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return ["no text returned"];

  const issues: string[] = [];
  const fences = (trimmed.match(/```/g) ?? []).length;
  if (fences % 2 !== 0) issues.push("an unclosed code block");
  if ((trimmed.match(/\*\*/g) ?? []).length % 2 !== 0) issues.push("unbalanced bold markers");
  if ((trimmed.match(/`/g) ?? []).length % 2 !== 0) issues.push("an unclosed inline code span");

  const last = trimmed.slice(-1);
  if (/[-–—:,;(]$/.test(last)) issues.push("it ends on a dangling mark");
  if (/[a-z]$/i.test(last)) {
    const tail = trimmed.split(/\s+/).slice(-3).join(" ").toLowerCase().replace(/[^a-z\s]/g, "");
    const dangling = /\b(and|or|but|the|a|an|of|to|with|for|from|in|on|as|that|which|because|so|if|when|by|is|are|was|were|will|would|than|then|at|it|its|also)\s*$/;
    if (dangling.test(tail)) issues.push("it stops on a connecting word");
    else if (!/[.!?"'’”)\]]$/.test(trimmed)) issues.push("it has no closing punctuation");
  }
  return issues;
}

/** True when a chunk reads finished. */
export function isComplete(text: string): boolean {
  return completionIssues(text).length === 0;
}

/* ── Prompts ─────────────────────────────────────────────────────────────── */

export const ARTICLE_SYSTEM = `You are the ConnectPlus Article Forge, the writing engine behind a professional East African news and culture platform.

You write finished, publishable prose. Rules that matter more than style:
- NEVER invent facts, statistics, quotes, dates, names or sources. If a detail is unknown, say what is unknown or omit it.
- Finish every sentence. Finish every paragraph. Finish the section you were asked for.
- Write in the given voice: concrete, plain, confident, no filler, no "in today's fast-paced world".
- Markdown only where it belongs: plain paragraphs in a section body, **bold** for a term worth noticing, no headings unless asked.
- Ground the piece in its place: Nairobi, Kampala, Dar es Salaam, Kigali, Mombasa, and the wider region when it is relevant.`;

export function outlinePrompt(request: ArticleRequest, targetWords: number): string {
  const keywords = (request.keywords ?? []).filter(Boolean).slice(0, 8);
  return [
    `Plan a ${targetWords}-word article.`,
    `Topic: ${clean(request.topic, MAX_TOPIC_CHARS)}`,
    request.angle ? `Angle: ${clean(request.angle, 200)}` : "",
    request.category ? `Category: ${clean(request.category, 60)}` : "",
    keywords.length ? `Must rank for: ${keywords.join(", ")}` : "",
    request.tone ? `Tone: ${clean(request.tone, 40)}` : "",
    "",
    "Return ONE JSON object and nothing else:",
    '{"title":"<headline, max 90 chars>","metaDescription":"<max 160 chars>","hook":"<one sentence describing how the piece opens>","sections":[{"heading":"<short, specific>","goal":"<what this section must cover, one sentence>"}],"faq":["<reader question>"],"tags":["<lowercase-tag>"]}',
    "Use 4 to 6 sections. Headings must be specific to this story — never \"Introduction\" or \"Conclusion\".",
  ]
    .filter(Boolean)
    .join("\n");
}

export function sectionPrompt(plan: ArticlePlan, index: number): string {
  const section = plan.sections[index];
  if (!section) return "";
  const previous = plan.sections.slice(0, index).map((s) => s.heading).join(" · ");
  return [
    `Article: ${plan.title}`,
    previous ? `Sections already written: ${previous}` : "This is the first section.",
    "",
    `Write the section "${section.heading}".`,
    `It must: ${section.goal}`,
    `Length: about ${section.targetWords} words. Finish the section — do not trail off.`,
    "Do not repeat the heading. Do not add a heading. Plain paragraphs only, 2 to 4 of them.",
  ].join("\n");
}

export function continuePrompt(plan: ArticlePlan, index: number, soFar: string, issues: string[]): string {
  const section = plan.sections[index];
  const tail = soFar.trim().slice(-600);
  return [
    `You were writing the section "${section?.heading ?? "the piece"}" of the article "${plan.title}" and the text was cut off (${
      issues.join("; ") || "it stopped early"
    }).`,
    "",
    "Here is the end of what you wrote:",
    tail,
    "",
    "Continue from exactly that point. Do not repeat any earlier sentence, do not restate the heading, and finish the thought completely so the section ends on a full stop.",
  ].join("\n");
}

/* ── Assembly ────────────────────────────────────────────────────────────── */

/** Strip a heading the model added although it was told not to. */
function stripLeadingHeading(body: string, heading: string): string {
  const lines = body.trim().split(/\n/);
  const first = lines[0]?.trim() ?? "";
  const isHeading = /^#{1,4}\s+/.test(first) || first.replace(/[#*_:\s]/g, "").toLowerCase() === heading.replace(/[#*_:\s]/g, "").toLowerCase();
  return (isHeading ? lines.slice(1).join("\n") : lines.join("\n")).trim();
}

export interface AssembledArticle {
  markdown: string;
  words: number;
  /** Sections whose body came back empty — the article must say so, not gloss. */
  missing: string[];
}

/**
 * Stitch the parts into one piece.
 *
 * Order is the plan's; headings are the plan's; empty sections are named rather
 * than left as a heading with nothing under it, because a heading with nothing
 * under it is what a half-finished draft looks like.
 */
export function assembleArticle(plan: ArticlePlan, parts: string[]): AssembledArticle {
  const blocks: string[] = [`# ${plan.title}`];
  const missing: string[] = [];

  const hook = (parts[0] ?? "").trim();
  if (hook) blocks.push(hook);

  plan.sections.forEach((section, i) => {
    const body = stripLeadingHeading((parts[i + 1] ?? "").trim(), section.heading);
    if (!body) {
      missing.push(section.heading);
      return;
    }
    blocks.push(`## ${section.heading}`, body);
  });

  // The FAQ arrives as one part, already shaped as "**question**\n\nanswer",
  // because that is how it is generated — one call for the block rather than
  // four calls that each have to be re-joined into it.
  const faq = stripLeadingHeading((parts[plan.sections.length + 1] ?? "").trim(), "Frequently asked questions");
  if (faq) blocks.push("## Frequently asked questions", faq);

  const markdown = blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  return { markdown, words: countWords(markdown), missing };
}

export function countWords(text: string): number {
  return text
    .replace(/[#*_>`|-]/g, " ")
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** The excerpt for a finished piece: the plan's description, trimmed to a snippet. */
export function excerptFor(plan: ArticlePlan, markdown: string): string {
  const description = plan.metaDescription.trim();
  if (description) {
    if (description.length <= 300) return description;
    return `${description.slice(0, 297)}...`;
  }
  const paragraph = markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .find((b) => b && !b.startsWith("#") && !b.startsWith("**"));
  return (paragraph ?? "").slice(0, 300);
}

/* ── The orchestrator ────────────────────────────────────────────────────── */

export interface ForgeProgress {
  phase: "planning" | "writing" | "finishing" | "done";
  /** 0-based index of the section being written. */
  sectionIndex: number;
  sections: number;
  label: string;
}

export interface ForgedArticle {
  plan: ArticlePlan;
  markdown: string;
  words: number;
  missing: string[];
  excerpt: string;
  tags: string[];
  /** What was cut and repaired, so the UI can be honest about it. */
  repairs: string[];
  /** True when generation was unavailable and the plan was expanded instead. */
  degraded: boolean;
  calls: number;
}

/** How many repair rounds one part may take before we accept it and report. */
const MAX_CONTINUATIONS_PER_PART = 2;

/**
 * A word budget that leaves room to finish.
 *
 * Roughly two tokens per English word plus a third of slack: the failure this
 * guards against is a budget that is exactly the length asked for, which is a
 * budget that forces a cut.
 */
function tokenBudget(words: number): number {
  return Math.min(1_600, Math.max(320, Math.round(words * 2.2)));
}

/**
 * Write a whole article.
 *
 * `ask` is the only dependency — on the server it is `generateText`, in the
 * browser it is a fetch to the studio endpoint — which is what lets the same
 * orchestrator be unit-tested with a fake model that deliberately truncates.
 * Each part loops until it reads finished, and every repair is recorded, so a
 * writer never receives a severed sentence as if it were the end of the piece.
 */
export async function forgeArticle(
  request: ArticleRequest,
  ask: ArticleAsk,
  opts: { onProgress?: (progress: ForgeProgress) => void; maxContinuations?: number } = {}
): Promise<ForgedArticle> {
  const targetWords = clampTargetWords(request.targetWords);
  const maxContinuations = opts.maxContinuations ?? MAX_CONTINUATIONS_PER_PART;
  const repairs: string[] = [];
  let calls = 0;

  opts.onProgress?.({ phase: "planning", sectionIndex: 0, sections: 0, label: "Planning the article" });

  let plan = planArticle({ ...request, targetWords });
  const outline = await ask({
    kind: "article-outline",
    prompt: outlinePrompt(request, targetWords),
    maxTokens: 900,
  }).catch(() => null);
  calls += 1;
  if (outline) {
    const parsed = parseArticleOutline(outline, { ...request, targetWords });
    if (parsed) plan = parsed;
  }

  /** Write one chunk and keep asking until it reads finished. */
  const writePart = async (kind: ArticleGeneration["kind"], prompt: string, words: number, label: string): Promise<string> => {
    let text = (await ask({ kind, prompt, maxTokens: tokenBudget(words) }).catch(() => null)) ?? "";
    calls += 1;
    let issues = completionIssues(text);

    for (let round = 0; round < maxContinuations && issues.length > 0; round += 1) {
      const sectionIndex = plan.sections.findIndex((s) => s.heading === label);
      const continuation = await ask({
        kind: "article-continue",
        prompt: continuePrompt(plan, sectionIndex, text, issues),
        maxTokens: tokenBudget(Math.max(90, words - countWords(text))),
      }).catch(() => null);
      calls += 1;
      if (!continuation) break;
      text = joinChunks(text, continuation);
      const before = issues;
      issues = completionIssues(text);
      if (issues.length > 0) repairs.push(`${label}: still ${issues[0]} after a repair round`);
      else repairs.push(`${label}: repaired after ${before[0]}`);
    }
    if (issues.length > 0) repairs.push(`${label}: ${issues[0]}`);
    return text;
  };

  const hook = await writePart("article-part", hookPrompt(plan), Math.max(90, Math.round(targetWords * 0.12)), "The opening");
  const parts: string[] = [hook];

  for (let i = 0; i < plan.sections.length; i += 1) {
    const section = plan.sections[i]!;
    opts.onProgress?.({
      phase: "writing",
      sectionIndex: i,
      sections: plan.sections.length,
      label: section.heading,
    });
    parts.push(await writePart("article-part", sectionPrompt(plan, i), section.targetWords, section.heading));
  }

  opts.onProgress?.({ phase: "finishing", sectionIndex: plan.sections.length, sections: plan.sections.length, label: "Answering reader questions" });

  // The FAQ block the plan promised. It is generated last and as one part, so a
  // section that runs long cannot eat the budget for the answers.
  if (plan.faq.length > 0) {
    parts.push(
      await writePart(
        "article-part",
        faqPrompt(plan),
        Math.max(90, Math.round(targetWords * 0.1)),
        "Frequently asked questions"
      )
    );
  }

  const degraded = parts.every((p) => !p.trim());
  if (degraded) {
    // No provider: expand the plan into a structured, honest scaffold rather than
    // returning nothing. The writer gets the shape and the beats, labelled.
    const scaffold = assembleArticle(plan, scaffoldParts(plan));
    opts.onProgress?.({ phase: "done", sectionIndex: plan.sections.length, sections: plan.sections.length, label: "Draft ready" });
    return {
      plan,
      markdown: scaffold.markdown,
      words: scaffold.words,
      missing: scaffold.missing,
      excerpt: excerptFor(plan, scaffold.markdown),
      tags: plan.tags,
      repairs: ["No writing model is configured — this is the structured plan you asked for, expanded into a skeleton draft."],
      degraded: true,
      calls,
    };
  }

  const assembled = assembleArticle(plan, parts);
  opts.onProgress?.({ phase: "done", sectionIndex: plan.sections.length, sections: plan.sections.length, label: "Draft ready" });

  return {
    plan,
    markdown: assembled.markdown,
    words: assembled.words,
    missing: assembled.missing,
    excerpt: excerptFor(plan, assembled.markdown),
    tags: plan.tags,
    repairs,
    degraded: false,
    calls,
  };
}

export function faqPrompt(plan: ArticlePlan): string {
  return [
    `Article: ${plan.title}`,
    "Answer these reader questions at the end of the piece. Each answer: two or three concrete sentences. Do not repeat the question text in the answer. Finish every answer.",
    ...plan.faq.map((q, i) => `${i + 1}. ${q}`),
    "",
    'Format each one exactly as "**question**" followed by a blank line and then the answer, in order. No extra headings.',
  ].join("\n");
}

function hookPrompt(plan: ArticlePlan): string {
  return [
    `Article: ${plan.title}`,
    plan.hook ? `How it should open: ${plan.hook}` : "",
    `Write the opening of this article — about ${Math.max(90, Math.round(plan.targetWords * 0.12))} words, two short paragraphs, no heading.`,
    "Lead with the most important fact. Give the reader a reason to keep going by the end of the second sentence.",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Join a repair round onto a cut chunk.
 *
 * A cut mid-sentence has to continue on the same line; a chunk that ended at a
 * paragraph break needs a blank line. Choosing wrongly is visible either way —
 * a stranded half-sentence on its own line, or a paragraph merged into another.
 */
export function joinChunks(text: string, continuation: string): string {
  const head = text.replace(/\s+$/, "");
  const tail = continuation.trim();
  if (!head) return tail;
  if (!tail) return head;
  const continuesSentence = /[^\s.!?"'’”)\]]$/.test(head);
  return continuesSentence ? `${head} ${tail}` : `${head}\n\n${tail}`;
}

/** The plan expanded into a skeleton — used only when no model is available. */
function scaffoldParts(plan: ArticlePlan): string[] {
  const parts: string[] = [plan.hook, ...plan.sections.map((section) => `_${section.goal}_`)];
  parts.push(
    plan.faq
      .map((question) => `**${question}**\n\n_Answer with the clearest fact you have on ${question.replace(/\?$/, "").toLowerCase()}._`)
      .join("\n\n")
  );
  return parts;
}
