import {
  polishText,
  continueText,
  buildOutline,
  generateHeadline,
  generateTopics,
  enhanceText,
  type PolishResult,
} from "@/lib/neural-generate";
import { summarizeText, stripHtml, extractKeywords } from "@/lib/neural-text";
import { neuralMind } from "@/lib/neural-mind";
import { hiveBrain } from "@/lib/hive-brain";
import { appBrain } from "@/lib/app-brain";
import type { PilotOp } from "@/lib/brain-pilot";
import { generateText, studioSystemPrompt } from "@/lib/ai-provider";
import { analyzeSeo } from "@/lib/seo-analyzer";
import { checkPlagiarism } from "@/lib/plagiarism-checker";
import { optimizeContent } from "@/lib/content-optimizer";
import { runWritingChecks, type WritingCheckResult, type WritingSuggestion } from "@/lib/writing-checks";
import {
  ARTICLE_SYSTEM,
  isArticleRequest,
  outlinePrompt,
  parseArticleOutline,
  planArticle,
  type ArticlePlan,
} from "@/lib/article-forge";
import { coerceCopilotOutcome, recordCopilotOutcomes } from "@/lib/copilot-skills";

export type StudioAction =
  | "rewrite"
  | "continue"
  | "outline"
  | "summarize"
  | "headline"
  | "tags"
  | "curate"
  | "assist"
  | "seo"
  | "plagiarism"
  | "optimize"
  | "inspect"
  /** The Brain Pilot: structured edits the composer applies in place. */
  | "pilot"
  /**
   * One bounded generation for the Article Forge. The forge itself runs in the
   * composer and asks for one part at a time, so a long article never depends on
   * a single request surviving a serverless timeout.
   */
  | "compose"
  /** Record what the writer did with the copilot's suggestions. */
  | "learn";

export interface StudioRequest {
  action: StudioAction;
  title?: string;
  content?: string;
  prompt?: string;
  selection?: string;
  /** The composer's other fields, so an action can reason about the whole post. */
  excerpt?: string;
  tags?: string[];
  category?: string;
  /**
   * For the `pilot` action: which edit the writer asked for (improve, shorten,
   * fix, expand, tone, headline, excerpt, tags, ask). Validated in `appBrain`,
   * which falls back to `improve` rather than trusting the wire.
   */
  pilotAction?: string;
  /** For `compose`: which forge system prompt to use. */
  promptKind?: string;
  /** For `compose`: the token ceiling for this one part. */
  maxTokens?: number;
  /** For `learn`: the decisions to record. Validated individually. */
  outcomes?: unknown;
}

export interface StudioResult {
  action: StudioAction;
  /** Main text the studio should write back (title / excerpt / tags / content). */
  text: string;
  alternatives?: string[];
  /** Inline, offset-addressed issues — only `inspect` returns these. */
  suggestions?: WritingSuggestion[];
  /**
   * Structured edits — only `pilot` returns these. The composer applies them
   * against the ranges it measured when it asked, so the reply can never write
   * over the wrong words.
   */
  ops?: PilotOp[];
  /** True when the pilot fell back to the deterministic engines. */
  degraded?: boolean;
  meta?: {
    notes?: string[];
    score?: number;
    grade?: string;
    heading?: string;
    topic?: string;
    tags?: string[];
    wordsBefore?: number;
    wordsAfter?: number;
    tone?: WritingCheckResult["tone"]["label"];
    counts?: Record<string, number>;
    stats?: WritingCheckResult["stats"];
  };
}

/**
 * Hard caps on what a single request may carry.
 *
 * These are not just resource guards: a draft longer than this is almost
 * certainly a paste of several articles, and silently analysing it would let
 * one request spend an unbounded amount of provider time. Truncating is
 * reported honestly in the notes rather than pretending the tail was checked.
 */
/**
 * The forge's prompt kinds.
 *
 * An allowlist rather than a passthrough: the kind selects a server-side system
 * prompt, and an unknown kind must not be able to reach a more permissive one.
 */
const ARTICLE_PROMPT_KINDS = new Set(["article-outline", "article-part", "article-continue"]);

export const MAX_DRAFT_CHARS = 40_000;
const MAX_TITLE_CHARS = 300;
const MAX_SELECTION_CHARS = 8_000;
const MAX_PROMPT_CHARS = 2_000;

/** Normalise and bound a free-text field. */
function bounded(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Bound the tag list and drop anything that is not a plain tag. */
function boundedTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase().replace(/^#/, "").slice(0, 40))
    .filter(Boolean)
    .slice(0, 20);
}

/**
 * The studio's Brain Copilot. Every action is a pure read→write operation over
 * the draft: the studio sends the current title/content/selection (read), the
 * brain returns the result (write), and the UI applies it at the cursor, the
 * title field, the excerpt field or the tag list.
 */
/** Try the LLM for a studio action, falling back to `null` on any failure. */
async function tryLlmAction(action: StudioAction, user: string, minLen = 40): Promise<string | null> {
  if (user.trim().length < minLen) return null;
  return generateText({ system: studioSystemPrompt(action), user, maxTokens: 700 });
}

function parseHeadlineOptions(text: string): { primary: string; alternatives: string[] } | null {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim().replace(/^\*+\s*/, "").replace(/\s+\*+$/, ""))
    .filter(Boolean);
  const options = lines
    .map((l) => l.replace(/^\d+[.)]\s*/, ""))
    .filter((l) => l.length > 8 && !/^(?:headline|title|suggestion)s?:?$/i.test(l));
  if (options.length >= 2) return { primary: options[0]!, alternatives: options.slice(1) };
  return null;
}

export async function runStudioBrain(req: StudioRequest): Promise<StudioResult> {
  const title = bounded(req.title, MAX_TITLE_CHARS);
  const content = bounded(req.content, MAX_DRAFT_CHARS);
  const prompt = bounded(req.prompt, MAX_PROMPT_CHARS);
  const selection = bounded(req.selection, MAX_SELECTION_CHARS);
  const action = req.action;
  const draft = selection.trim() ? selection : content;

  // The composer's other fields, so an action can reason about the whole post
  // and not just the body the cursor happens to be in.
  const excerpt = bounded(req.excerpt, 500);
  const tags = boundedTags(req.tags);
  const category = bounded(req.category, 80);
  const composerContext = [
    category ? `Category: ${category}` : "",
    tags.length ? `Tags: ${tags.join(", ")}` : "",
    excerpt ? `Excerpt: ${excerpt}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  switch (action) {
    case "rewrite": {
      const llm = await tryLlmAction(action, `Rewrite this draft tightly — then list key changes as short bullets after a line starting with "Changes:":\n\n${draft}`);
      if (llm) {
        const idx = llm.indexOf("Changes:");
        const text = (idx > 0 ? llm.slice(0, idx) : llm).trim();
        const notes = idx > 0 ? llm.slice(idx).split(/\n/).map((n) => n.replace(/^[-•*]\s*/, "")).filter(Boolean) : [];
        return {
          action,
          text,
          meta: { notes, wordsBefore: draft.split(/\s+/).filter(Boolean).length, wordsAfter: text.split(/\s+/).filter(Boolean).length },
        };
      }
      const polish: PolishResult = polishText(draft || prompt);
      return {
        action,
        text: polish.rewritten,
        meta: {
          notes: polish.notes,
          wordsBefore: polish.original.split(/\s+/).filter(Boolean).length,
          wordsAfter: polish.rewritten.split(/\s+/).filter(Boolean).length,
        },
      };
    }

    case "continue": {
      const llm = await tryLlmAction(action, `Continue writing from where this draft stops — match its voice and extend it by a paragraph or two:\n\n${draft}`);
      if (llm) return { action, text: llm };
      const ext = continueText(draft || prompt);
      return {
        action,
        text: ext.continuation,
        meta: { heading: ext.heading },
      };
    }

    case "outline": {
      const llm = await tryLlmAction(action, `Build a clear post outline for this draft/topic:\n\n${draft || prompt}`);
      if (llm) return { action, text: llm };
      const outline = buildOutline(draft || prompt);
      const text = [`**Intro** — ${outline.intro}`, "", ...outline.sections, "", `**Closing** — ${outline.closing}`].join("\n");
      return { action, text };
    }

    case "summarize": {
      const llm = await tryLlmAction(action, `Write a punchy 2-sentence excerpt (max 280 characters) for this draft — no quotes, no labels:\n\n${draft}`);
      if (llm) return { action, text: llm.slice(0, 280) };
      const summary = summarizeText(stripHtml(draft || prompt), 2).slice(0, 280);
      return { action, text: summary };
    }

    case "headline": {
      const firstLine = (draft.split(/\n/)[0] || title || "Untitled").slice(0, 60);
      const llm = await tryLlmAction(action, `Suggest 5 headlines for this piece (one per line, numbered). Best first:\n\nTitle: ${firstLine}\n\nDraft:\n${draft}`, 60);
      if (llm) {
        const parsed = parseHeadlineOptions(llm);
        if (parsed) return { action, text: parsed.primary, alternatives: parsed.alternatives };
        return { action, text: llm.slice(0, 120) };
      }
      const result = generateHeadline(firstLine, draft || title);
      return { action, text: result.primary, alternatives: result.alternatives };
    }

    case "tags": {
      // Tags stay deterministic: they must be clean, structured, SEO-ready.
      const result = generateTopics(draft || prompt || title);
      const all = [result.primary, ...result.alternatives]
        .map((t) => t.toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
        .filter(Boolean)
        .slice(0, 8);
      return { action, text: all.join(", "), meta: { tags: all } };
    }

    case "curate": {
      const [analysis, engagement, hive] = await Promise.all([
        neuralMind.analyzeContent(),
        hiveBrain.computeEngagement(),
        hiveBrain.status(),
      ]);
      const lines: string[] = ["**Curation brief — what to write & publish next**", ""];
      if (engagement.categories.length > 0) {
        lines.push("**Hottest categories right now:**");
        engagement.categories.slice(0, 5).forEach((c, i) => lines.push(`${i + 1}. **${c.name}** — ${c.posts} posts, velocity ${c.velocity.toFixed(0)}`));
        lines.push("");
      }
      if (analysis.topTopics.length > 0) {
        lines.push("**Angles already performing:**");
        analysis.topTopics.slice(0, 4).forEach((t, i) => lines.push(`${i + 1}. ${t.topic} — ${t.count} posts, avg ${Math.round(t.avgViews)} views`));
        lines.push("");
      }
      if (engagement.trending.length > 0) {
        lines.push("**Trending right now (great for a follow-up or rebuttal):**");
        engagement.trending.slice(0, 3).forEach((p) => lines.push(`• \"${p.title}\" — ${p.categoryName ?? "uncategorized"} (${p.views} views)`));
      }
      lines.push("", `_The hive currently holds ${hive.total} memories. Say \"write about <topic>\" and I'll draft the first version._`);
      return { action, text: lines.join("\n") };
    }

    case "assist": {
      /**
       * "Write me an article about X" is not an instruction to apply to the
       * draft — it is a request for a piece, and answering it with one 700-token
       * completion is exactly how the copilot used to hand back a severed
       * introduction. The structure is planned here, in one call, and the draft
       * itself is written section by section by the forge (see
       * `src/lib/article-forge.ts`), which is the only way a long piece finishes.
       */
      const articleRequest = isArticleRequest(prompt);
      if (articleRequest) {
        const base = {
          topic: articleRequest.topic,
          category,
          keywords: tags,
          targetWords: articleRequest.targetWords,
        };
        const outline = await generateText({
          system: ARTICLE_SYSTEM,
          user: outlinePrompt(base, articleRequest.targetWords),
          maxTokens: 900,
        }).catch(() => null);
        const refined = outline ? parseArticleOutline(outline, base) : null;
        const plan: ArticlePlan = refined ?? planArticle(base);
        const lines = [
          `**${plan.title}**`,
          "",
          `_${plan.metaDescription}_`,
          "",
          `**Structure — ${plan.sections.length} sections, about ${plan.targetWords} words:**`,
          ...plan.sections.map((s, i) => `${i + 1}. **${s.heading}** — ${s.goal}`),
          "",
          "**Reader questions it will answer:**",
          ...plan.faq.map((q) => `• ${q}`),
          "",
          `**Suggested tags:** ${plan.tags.join(", ")}`,
          "",
          "_Open **Write** in the assist panel and I will draft every section in order — finishing each one before moving on — then hand you the finished piece to review._",
        ];
        return {
          action,
          text: lines.join("\n"),
          meta: {
            topic: plan.title,
            tags: plan.tags,
            notes: [
              refined
                ? "Plan refined by the writing model — review the headings before drafting."
                : "Plan built from the platform's own structure (no writing model configured).",
            ],
          },
        };
      }

      // Free-form prompt: try the LLM first with the draft (and the rest of the
      // composer) attached, then fall back to the conversational content brain.
      const hasDraft = (content || "").trim().length > 20;
      const isInstruction = prompt.trim().length < 120;
      const message = [
        hasDraft && isInstruction ? `${prompt.trim()}: ${content}` : prompt,
        composerContext ? `Post context:\n${composerContext}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const llm = await tryLlmAction(action, message);
      if (llm) return { action, text: llm };
      // The fallback goes through the *unified* brain rather than the neural
      // mind alone, so a copilot answer is composed from the same three engines
      // (memory, reasoning, live platform senses) as everything else in the app
      // instead of being a second, narrower mind with its own opinions.
      const response = await appBrain.think(message);
      return {
        action,
        text: response.context ? `${response.text}\n\n_Live context: ${response.context}_` : response.text,
      };
    }

    case "seo": {
      const analysis = analyzeSeo(title, content, prompt);
      const lines: string[] = [`**SEO Analysis — Score: ${analysis.score}/100 (${analysis.grade})**`, ""];
      if (analysis.keywordDensity.length > 0) {
        lines.push("**Top Keywords:**");
        analysis.keywordDensity.slice(0, 5).forEach(k => lines.push(`• ${k.keyword}: ${k.count} mentions (${k.density}%)`));
        lines.push("");
      }
      lines.push(`**Readability:** ${analysis.readabilityGrade} (${analysis.readabilityScore}/100)`);
      lines.push(`**Content:** ${analysis.contentLength.words} words · ${analysis.contentLength.sentences} sentences · ${analysis.contentLength.paragraphs} paragraphs`);
      lines.push(`**Headings:** ${analysis.headingStructure.length}`);
      lines.push(`**Images:** ${analysis.imageCount} (${analysis.imagesWithAlt} with alt text)`);
      lines.push(`**Links:** ${analysis.internalLinks} internal · ${analysis.externalLinks} external`);
      if (analysis.suggestions.length > 0) {
        lines.push("", "**Suggestions:**");
        analysis.suggestions.forEach(s => lines.push(`${s.priority === "high" ? "🔴" : s.priority === "medium" ? "🟡" : "🟢"} [${s.category}] ${s.message}`));
      }
      return { action, text: lines.join("\n"), meta: { score: analysis.score, grade: analysis.grade } };
    }

    case "plagiarism": {
      const result = await checkPlagiarism(title, content);
      const lines: string[] = [`**Plagiarism Check — ${result.overallScore}% similarity**`, ""];
      if (result.isOriginal) {
        lines.push("✅ Content appears original. No significant matches found.");
      } else {
        lines.push(`⚠️ Similarity detected (${result.overallScore}%). Review flagged content.`);
      }
      if (result.matchingArticles.length > 0) {
        lines.push("", "**Matching Articles:**");
        result.matchingArticles.slice(0, 3).forEach(a => lines.push(`• \"${a.title}\" — ${a.similarity}% similar (${a.matchedSentences.length} sentences matched)`));
      }
      if (result.sentenceAnalysis.length > 0) {
        lines.push("", "**Flagged Sentences:**");
        result.sentenceAnalysis.slice(0, 5).forEach(s => lines.push(`• \"${s.sentence.slice(0, 80)}...\" (${s.similarity}% match)`));
      }
      if (result.suggestions.length > 0) {
        lines.push("", "**Recommendations:**");
        result.suggestions.forEach(s => lines.push(`• ${s}`));
      }
      return { action, text: lines.join("\n"), meta: { score: result.overallScore } };
    }

    case "optimize": {
      const result = await optimizeContent(title, content, prompt);
      const lines: string[] = [`**Content Optimization Report — ${result.overallScore}/100 (${result.overallGrade})**`, ""];
      lines.push(`**Summary:** ${result.summary}`);
      lines.push("");
      lines.push(`**SEO:** ${result.seo.score}/100 (${result.seo.grade})`);
      lines.push(`**Quality:** ${result.contentQuality.score}/100 (${result.contentQuality.grade})`);
      lines.push(`**Originality:** ${100 - result.plagiarism.overallScore}/100`);
      lines.push("");
      lines.push("**Quality Metrics:**");
      lines.push(`• Sentence variety: ${result.contentQuality.metrics.sentenceVariety}/100`);
      lines.push(`• Paragraph balance: ${result.contentQuality.metrics.paragraphBalance}/100`);
      lines.push(`• Transition usage: ${result.contentQuality.metrics.transitionUsage}/100`);
      lines.push(`• Active voice: ${result.contentQuality.metrics.activeVoice}%`);
      lines.push(`• Factual density: ${result.contentQuality.metrics.factualDensity}/100`);
      if (result.optimizationPlan.length > 0) {
        lines.push("", "**Optimization Plan:**");
        result.optimizationPlan.forEach(p => {
          const icon = p.priority === "critical" ? "🔴" : p.priority === "important" ? "🟡" : "🟢";
          lines.push(`${icon} [${p.category}] ${p.action}`);
          lines.push(`   Impact: ${p.impact}`);
        });
      }
      return { action, text: lines.join("\n"), meta: { score: result.overallScore, grade: result.overallGrade } };
    }

    /**
     * The Brain Pilot — read the composer, write back into it.
     *
     * Distinct from every action above, which return *text* for the writer to
     * place by hand. The pilot returns operations, which is what makes it an
     * assistant rather than a chat window: "tighten this paragraph" lands as an
     * edit to that paragraph, not as a suggestion the writer has to retype.
     */
    case "pilot": {
      const result = await appBrain.pilot({
        action: bounded(req.pilotAction, 40) || "improve",
        content,
        title,
        excerpt,
        tags,
        category,
        selection,
        instruction: prompt || undefined,
      });
      return {
        action,
        text: result.reply,
        ops: result.ops,
        degraded: result.degraded,
        meta: {
          notes:
            result.ops.length > 0
              ? [`${result.ops.length} edit${result.ops.length === 1 ? "" : "s"} ready to apply.`]
              : [],
        },
      };
    }

    /**
     * One bounded generation for the Article Forge.
     *
     * The system prompt is chosen *here*, from the kind the forge asked for, and
     * never sent by the caller — the writer's text goes in as user content, so a
     * composer cannot repurpose the studio's provider as a general-purpose
     * chatbot by rewriting our instructions.
     */
    case "compose": {
      const kind = bounded(req.promptKind, 40);
      const user = bounded(req.prompt, 12_000);
      if (user.trim().length < 20) return { action, text: "", degraded: true };
      const maxTokens = Math.max(200, Math.min(1_600, Math.round(req.maxTokens ?? 900)));
      const text = await generateText({
        system: ARTICLE_PROMPT_KINDS.has(kind) ? ARTICLE_SYSTEM : studioSystemPrompt("compose"),
        user,
        maxTokens,
      });
      return {
        action,
        text: text ?? "",
        degraded: !text,
        meta: {
          notes: text
            ? []
            : ["No writing model is configured, so this part fell back to the platform's own draft."],
        },
      };
    }

    /**
     * Remember what the writer did with the copilot's suggestions.
     *
     * Every kept or discarded edit is a labelled example of what this
     * publication wants, and the notes distilled from them are fed back into the
     * pilot's prompt (see `src/lib/copilot-skills.ts`). Writing the rows is the
     * only thing that happens here — summarising is a read path, so a burst of
     * edits stays cheap.
     */
    case "learn": {
      const list = Array.isArray(req.outcomes) ? req.outcomes : [];
      const outcomes = list
        .map(coerceCopilotOutcome)
        .filter((outcome): outcome is NonNullable<ReturnType<typeof coerceCopilotOutcome>> => outcome !== null);
      const stored = await recordCopilotOutcomes(outcomes);
      return {
        action,
        text: stored > 0 ? `Learned from ${stored} decision${stored === 1 ? "" : "s"}.` : "Nothing to learn from that.",
      };
    }

    /**
     * Live inline checks — the Grammarly-shaped half of the copilot.
     *
     * Deliberately deterministic and provider-free. This runs on a debounce
     * while the writer types, so it has to be instant, free, and identical on
     * every deployment; an LLM here would mean a network round trip per pause
     * and a different result each time. The judgement-level actions stay on the
     * explicit buttons above.
     */
    case "inspect": {
      const check = runWritingChecks(content);
      const truncated = req.content ? req.content.length > MAX_DRAFT_CHARS : false;
      const notes = truncated
        ? [`Only the first ${MAX_DRAFT_CHARS.toLocaleString()} characters were checked.`]
        : [];
      const summary =
        check.suggestions.length === 0
          ? `Clean draft — score ${check.score}/100 (${check.grade}).`
          : `${check.suggestions.length} suggestion${check.suggestions.length === 1 ? "" : "s"} · score ${check.score}/100 (${check.grade}).`;
      return {
        action,
        text: summary,
        suggestions: check.suggestions,
        meta: {
          score: check.score,
          grade: check.grade,
          tone: check.tone.label,
          counts: check.counts,
          stats: check.stats,
          notes,
        },
      };
    }

    default:
      return { action, text: "" };
  }
}

/** Draft-quality diagnostics (read-only companion to the writing actions). */
export function readDraftQuality(content: string) {
  const quality = enhanceText(content);
  const keywords = extractKeywords(content, 5).map((k) => k.keyword);
  return { quality, keywords };
}