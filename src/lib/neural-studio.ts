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
import { generateText, studioSystemPrompt } from "@/lib/ai-provider";
import { analyzeSeo } from "@/lib/seo-analyzer";
import { checkPlagiarism } from "@/lib/plagiarism-checker";
import { optimizeContent } from "@/lib/content-optimizer";

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
  | "optimize";

export interface StudioRequest {
  action: StudioAction;
  title?: string;
  content?: string;
  prompt?: string;
  selection?: string;
}

export interface StudioResult {
  action: StudioAction;
  /** Main text the studio should write back (title / excerpt / tags / content). */
  text: string;
  alternatives?: string[];
  meta?: {
    notes?: string[];
    score?: number;
    grade?: string;
    heading?: string;
    topic?: string;
    tags?: string[];
    wordsBefore?: number;
    wordsAfter?: number;
  };
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
  const { action, title = "", content = "", prompt = "", selection } = req;
  const draft = selection?.trim() ? selection : content;

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
      // Free-form prompt: try the LLM first with the draft attached, then fall
      // back to the conversational content brain.
      const hasDraft = (content || "").trim().length > 20;
      const isInstruction = prompt.trim().length < 120;
      const message = hasDraft && isInstruction ? `${prompt.trim()}: ${content}` : prompt;
      const llm = await tryLlmAction(action, message);
      if (llm) return { action, text: llm };
      const response = await neuralMind.processQuery(message);
      return { action, text: response.text };
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