"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Gauge,
  Loader2,
  PenLine,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { analyzeSeo } from "@/lib/seo-analyzer";
import { PILOT_QUICK_ACTIONS, type PilotAction } from "@/lib/brain-pilot";
import type { WritingSuggestion } from "@/lib/writing-checks";
import type { EditorRange } from "./CheckedEditor";

/**
 * The inline AI assist widget — the copilot, in the composer, with read/write
 * access to everything in it.
 *
 * It replaces a selection toolbar that could only rewrite the passage you had
 * highlighted. Three complaints shaped this version:
 *
 *   • **"Not feature rich."** One row of rewrite buttons is not an assistant. The
 *     widget carries the live writing checks, the SEO audit, the field-level
 *     actions (headline, excerpt, tags) and a full-article engine, each in the
 *     same panel and each writing through the same review flow.
 *   • **"Poorly integrated."** It reads and writes the *composer*, not a copy of
 *     it: corrections splice into their exact range, rewrites are proposed for
 *     the passage you selected, and the article engine fills the draft, the
 *     headline, the excerpt and the tags in one pass.
 *   • **"Not mobile friendly."** The header row is what sticks to the bottom of
 *     the screen, above the mobile navigation. The panel it opens sits in normal
 *     flow, because a sticky panel on a 320px screen is a panel that covers the
 *     paragraph it is talking about.
 *
 * Two things are deliberately *not* model-backed: the writing checks and the SEO
 * audit. Both run locally on every keystroke, so the numbers a writer sees while
 * typing are instant and identical on every deployment.
 */

export interface AssistChecks {
  suggestions: WritingSuggestion[];
  score: number;
  grade: string;
  tone: string;
  counts: Record<string, number>;
}

export interface AssistArticleSummary {
  title: string;
  words: number;
  sections: number;
  repairs: string[];
  degraded: boolean;
}

export interface AssistArticleState {
  busy: boolean;
  /** "Section 3 of 5 — What the numbers say", or null when idle. */
  progress: string | null;
  error: string | null;
  summary: AssistArticleSummary | null;
}

type Tab = "assist" | "seo" | "write";

const KIND_STYLE: Record<string, string> = {
  correctness: "border-red-500/30 bg-red-500/10 text-red-300",
  clarity: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  engagement: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  style: "border-surface-600 bg-surface-800 text-surface-300",
};

/** The field actions, which are what "feature rich" means in practice. */
const FIELD_ACTIONS: { id: PilotAction; label: string }[] = [
  { id: "headline", label: "Headline" },
  { id: "excerpt", label: "Excerpt" },
  { id: "tags", label: "Tags" },
];

const LENGTHS = [
  { words: 600, label: "Short · ~600 words" },
  { words: 1_200, label: "Standard · ~1,200 words" },
  { words: 1_800, label: "Long read · ~1,800 words" },
];

export function InlineAssist({
  title,
  content,
  excerpt,
  tags,
  selection,
  checks,
  checksBusy,
  suggestionsBusy,
  pilotBusy,
  onApplySuggestion,
  onApplyAllSuggestions,
  onDismissSuggestion,
  onPilot,
  article,
  defaultTopic,
  onWriteArticle,
  onUseArticle,
  onDiscardArticle,
}: {
  title: string;
  content: string;
  excerpt: string;
  tags: string[];
  selection: EditorRange;
  checks: AssistChecks | null;
  checksBusy: boolean;
  /** True while the URL is being recorded as a copilot outcome. */
  suggestionsBusy?: boolean;
  pilotBusy: PilotAction | null;
  onApplySuggestion: (suggestion: WritingSuggestion) => void;
  onApplyAllSuggestions: () => void;
  onDismissSuggestion: (id: string) => void;
  onPilot: (action: PilotAction, instruction?: string) => void;
  article: AssistArticleState;
  defaultTopic: string;
  onWriteArticle: (topic: string, targetWords: number) => void;
  onUseArticle: () => void;
  onDiscardArticle: () => void;
}) {
  const [tab, setTab] = useState<Tab>("assist");
  const [open, setOpen] = useState(true);
  const [topic, setTopic] = useState("");
  const [words, setWords] = useState(1_200);
  const [instruction, setInstruction] = useState("");

  const draftWords = content.split(/\s+/).filter(Boolean).length;
  const suggestions = checks?.suggestions ?? [];
  const autoFixable = suggestions.filter((s) => s.replacement !== null);
  const hasDraft = content.trim().length >= 20;
  const busy = pilotBusy !== null;

  /**
   * The SEO audit, computed locally on every render.
   *
   * It reads the same title/body/excerpt the composer holds, so the panel can
   * never disagree with the draft — and it costs nothing, which is why it can
   * update while the writer types instead of behind a button.
   */
  const seo = useMemo(
    () => analyzeSeo(title, content, excerpt),
    [title, content, excerpt]
  );
  const seoChecks = useMemo(() => buildSeoChecks(title, excerpt, content, seo), [title, excerpt, content, seo]);

  const runPilot = (action: PilotAction) => {
    if (action === "ask") {
      const text = instruction.trim();
      if (!text) return;
      onPilot("ask", text);
      setInstruction("");
      return;
    }
    onPilot(action);
  };

  return (
    <div className="space-y-2">
      {/* The sticky row: the only part that has to stay in reach. */}
      <div className="sticky bottom-[calc(3.75rem+env(safe-area-inset-bottom))] z-50 md:bottom-2">
        <div className="flex items-center gap-2 rounded-xl border border-accent-violet/30 bg-surface-900/95 p-1.5 shadow-glow backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            /* Addressed by tests: the header row is the one part that has to
               stay clear of the mobile bottom navigation, and a tap is what
               proves it. */
            data-copilot-header=""
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-800/60"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent-violet" />
            <span className="type-caption shrink-0 font-semibold uppercase tracking-wider text-accent-violet">
              Copilot
            </span>
            {checks ? (
              <span className="flex min-w-0 items-center gap-1.5 truncate type-caption text-surface-400">
                <span
                  className={cn(
                    "shrink-0 rounded border px-1.5 py-0.5 font-semibold",
                    checks.score >= 90
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                      : checks.score >= 75
                        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                        : "border-red-500/30 bg-red-500/10 text-red-300"
                  )}
                >
                  {checks.score}
                </span>
                <span className="truncate">
                  {checksBusy && suggestions.length === 0
                    ? "checking…"
                    : suggestions.length === 0
                      ? "clean"
                      : `${suggestions.length} issue${suggestions.length === 1 ? "" : "s"}`}
                  {" · "}
                  {draftWords} words
                </span>
              </span>
            ) : (
              <span className="type-caption truncate text-surface-500">
                {draftWords > 0 ? `${draftWords} words` : "write a line and I'll start"}
              </span>
            )}
            <ChevronDown
              className={cn("ml-auto h-3.5 w-3.5 shrink-0 text-surface-500 transition-transform", open && "rotate-180")}
            />
          </button>
          {autoFixable.length > 0 ? (
            <button
              type="button"
              disabled={suggestionsBusy}
              onClick={onApplyAllSuggestions}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 type-caption font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
            >
              <Wand2 className="h-3 w-3" />
              Fix {autoFixable.length}
            </button>
          ) : null}
        </div>
      </div>

      {open ? (
        <section
          aria-label="Copilot panel"
          className="rounded-2xl border border-surface-800 bg-surface-950/60 p-3"
        >
          <div className="flex items-center gap-1 rounded-xl bg-surface-900/70 p-1">
            {(
              [
                { id: "assist" as Tab, label: "Assist", count: suggestions.length },
                { id: "seo" as Tab, label: "SEO", count: seo.suggestions.length },
                { id: "write" as Tab, label: "Write", count: 0 },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 type-caption font-semibold transition-colors",
                  tab === t.id ? "bg-surface-800 text-surface-100" : "text-surface-400 hover:text-surface-200"
                )}
              >
                {t.id === "seo" ? <Gauge className="h-3 w-3" /> : t.id === "write" ? <PenLine className="h-3 w-3" /> : null}
                {t.label}
                {t.count > 0 ? (
                  <span className="rounded bg-surface-700 px-1 text-[10px] font-bold text-surface-300">{t.count}</span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === "assist" ? (
            <div className="mt-3 space-y-3">
              {/* Live corrections, addressed by character range. */}
              {suggestions.length > 0 ? (
                <ul className="space-y-1.5">
                  {suggestions.slice(0, 8).map((s) => (
                    <li
                      key={s.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-surface-800 bg-surface-900/50 p-2"
                    >
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          KIND_STYLE[s.kind] ?? KIND_STYLE.style
                        )}
                      >
                        {s.kind}
                      </span>
                      <span className="min-w-0 flex-1 type-meta text-surface-300">{s.message}</span>
                      {s.replacement !== null ? (
                        <span className="type-caption flex items-center gap-1 text-surface-400">
                          <span className="rounded bg-red-500/10 px-1 text-red-300/90 line-through">{s.original}</span>
                          <span className="text-surface-600">→</span>
                          <span className="rounded bg-emerald-500/10 px-1 text-emerald-200">{s.replacement}</span>
                        </span>
                      ) : null}
                      <div className="ml-auto flex shrink-0 items-center gap-1">
                        {s.replacement !== null ? (
                          <button
                            type="button"
                            onClick={() => onApplySuggestion(s)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 type-caption font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                          >
                            <Check className="h-3 w-3" />
                            Apply
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onDismissSuggestion(s.id)}
                          aria-label={`Dismiss: ${s.message}`}
                          className="rounded-lg border border-surface-700 px-2 py-1 type-caption text-surface-400 transition-colors hover:text-surface-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="type-meta text-surface-500">
                  {checksBusy
                    ? "Reading the draft…"
                    : hasDraft
                      ? "No corrections to make — the draft reads clean."
                      : "Write a few sentences and I'll start checking them as you type."}
                </p>
              )}

              {/* Rewrites and field actions, all staged for review. */}
              <div>
                <p className="mb-1.5 type-caption font-semibold uppercase tracking-wider text-surface-500">
                  {selection.hasSelection ? "Rewrite the selection" : "Work on the whole draft"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PILOT_QUICK_ACTIONS.filter((a) => a.id !== "ask").map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      title={a.hint}
                      disabled={busy || !hasDraft}
                      onClick={() => runPilot(a.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-accent-violet/25 bg-accent-violet/10 px-2.5 py-1.5 type-caption font-medium text-accent-violet transition-colors hover:bg-accent-violet/20 disabled:opacity-40"
                    >
                      {pilotBusy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {a.label}
                    </button>
                  ))}
                  <span className="mx-0.5 w-px self-stretch bg-surface-800" />
                  {FIELD_ACTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={busy || !hasDraft}
                      onClick={() => runPilot(a.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-2.5 py-1.5 type-caption font-medium text-surface-300 transition-colors hover:text-surface-50 disabled:opacity-40"
                    >
                      {pilotBusy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <form
                className="flex items-center gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  runPilot("ask");
                }}
              >
                <input
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder="Tell the pilot what to change…"
                  aria-label="Instruction for the pilot"
                  className="min-w-0 flex-1 rounded-lg border border-surface-700 bg-surface-900/70 px-2.5 py-1.5 type-meta text-editor placeholder-surface-600 focus:border-accent-violet/40 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !instruction.trim() || !hasDraft}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet to-brand-500 px-3 py-1.5 type-caption font-semibold text-white shadow-glow transition hover:scale-[1.02] disabled:opacity-40"
                >
                  {pilotBusy === "ask" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Ask
                </button>
              </form>
            </div>
          ) : null}

          {tab === "seo" ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-800">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width] duration-300",
                      seo.score >= 75 ? "bg-emerald-500" : seo.score >= 55 ? "bg-amber-500" : "bg-red-500"
                    )}
                    style={{ width: `${Math.max(3, seo.score)}%` }}
                  />
                </div>
                <span className="shrink-0 type-caption font-semibold text-surface-300">
                  {seo.score}/100 · {seo.grade}
                </span>
              </div>

              {tags.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="type-caption text-surface-500">Tags:</span>
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded border border-surface-700 bg-surface-900/60 px-1.5 py-0.5 type-caption text-surface-300"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}

              <ul className="space-y-1.5">
                {seoChecks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 type-meta">
                    <span
                      className={cn(
                        "mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        c.state === "ok" ? "bg-emerald-500" : c.state === "warn" ? "bg-amber-500" : "bg-red-500"
                      )}
                    />
                    <span className="text-surface-300">
                      <span className="font-semibold text-surface-200">{c.label}</span> — {c.detail}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={busy || !hasDraft}
                  onClick={() => runPilot("headline")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-2.5 py-1.5 type-caption font-medium text-surface-300 transition-colors hover:text-surface-50 disabled:opacity-40"
                >
                  {pilotBusy === "headline" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Suggest a headline
                </button>
                <button
                  type="button"
                  disabled={busy || !hasDraft}
                  onClick={() => runPilot("excerpt")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-2.5 py-1.5 type-caption font-medium text-surface-300 transition-colors hover:text-surface-50 disabled:opacity-40"
                >
                  {pilotBusy === "excerpt" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Write the excerpt
                </button>
                <button
                  type="button"
                  disabled={busy || !hasDraft}
                  onClick={() => runPilot("tags")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-2.5 py-1.5 type-caption font-medium text-surface-300 transition-colors hover:text-surface-50 disabled:opacity-40"
                >
                  {pilotBusy === "tags" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Add tags
                </button>
                <button
                  type="button"
                  disabled={busy || !hasDraft}
                  onClick={() => onPilot("ask", "Optimise this piece for search: improve the title, the opening paragraph and the keyword coverage. Return the rewritten opening only.")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent-violet/25 bg-accent-violet/10 px-2.5 py-1.5 type-caption font-medium text-accent-violet transition-colors hover:bg-accent-violet/20 disabled:opacity-40"
                >
                  Optimise for search
                </button>
              </div>

              {seo.suggestions.length > 0 ? (
                <ul className="space-y-1.5 border-t border-surface-800 pt-3">
                  {seo.suggestions.slice(0, 6).map((s, i) => (
                    <li key={`${s.category}-${i}`} className="flex items-start gap-2 type-meta text-surface-400">
                      <AlertCircle
                        className={cn(
                          "mt-0.5 h-3 w-3 shrink-0",
                          s.priority === "high" ? "text-red-400" : s.priority === "medium" ? "text-amber-400" : "text-surface-500"
                        )}
                      />
                      <span>
                        <span className="font-semibold text-surface-300">{s.category}</span> — {s.message}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {tab === "write" ? (
            <div className="mt-3 space-y-3">
              <p className="type-meta text-surface-400">
                I plan the piece, then write it a section at a time — finishing each one before moving on — so a long
                article never stops mid-sentence. You review the headline, the draft, the excerpt and the tags before
                any of it reaches the composer.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={defaultTopic || "What should the article be about?"}
                  aria-label="Article topic"
                  className="min-w-0 flex-1 rounded-lg border border-surface-700 bg-surface-900/70 px-2.5 py-1.5 type-meta text-editor placeholder-surface-600 focus:border-accent-violet/40 focus:outline-none"
                />
                <select
                  value={words}
                  onChange={(e) => setWords(Number(e.target.value))}
                  aria-label="Article length"
                  className="shrink-0 rounded-lg border border-surface-700 bg-surface-900/70 px-2 py-1.5 type-caption text-surface-300 focus:border-accent-violet/40 focus:outline-none"
                >
                  {LENGTHS.map((l) => (
                    <option key={l.words} value={l.words}>
                      {l.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={article.busy || (topic.trim() || defaultTopic).length < 4}
                  onClick={() => onWriteArticle(topic.trim() || defaultTopic, words)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet to-brand-500 px-3 py-1.5 type-caption font-semibold text-white shadow-glow transition hover:scale-[1.02] disabled:opacity-40"
                >
                  {article.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  {article.busy ? "Writing…" : "Write the full article"}
                </button>
              </div>

              {article.busy && article.progress ? (
                <p className="flex items-center gap-2 type-meta text-accent-violet">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {article.progress}
                </p>
              ) : null}

              {article.error ? (
                <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-2 type-meta text-red-300">
                  {article.error}
                </p>
              ) : null}

              {article.summary ? (
                <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-2.5">
                  <p className="type-meta font-semibold text-surface-200">{article.summary.title}</p>
                  <p className="mt-0.5 type-caption text-surface-400">
                    {article.summary.words} words · {article.summary.sections} sections
                    {article.summary.repairs.length > 0 ? ` · ${article.summary.repairs.length} repair${article.summary.repairs.length === 1 ? "" : "s"}` : ""}
                  </p>
                  {article.summary.repairs.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5">
                      {article.summary.repairs.slice(0, 6).map((r) => (
                        <li key={r} className="type-caption text-surface-500">
                          • {r}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={onUseArticle}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 type-caption font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                    >
                      <Check className="h-3 w-3" />
                      Review before it lands
                    </button>
                    <button
                      type="button"
                      onClick={onDiscardArticle}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-surface-700 px-2.5 py-1.5 type-caption font-medium text-surface-300 transition-colors hover:text-surface-50"
                    >
                      <X className="h-3 w-3" />
                      Discard
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * The SEO checks a writer can act on, in the order they matter.
 *
 * Every line is derived from the draft itself rather than from a model, so the
 * panel updates as the words arrive and never needs a request. The ranges are
 * the well-known ones: a headline under ~60 characters survives a search result
 * intact, a description of 120–160 characters is the snippet, and a body needs
 * its primary keyword early and a subheading structure to be scannable.
 */
export function buildSeoChecks(
  title: string,
  excerpt: string,
  content: string,
  seo: ReturnType<typeof analyzeSeo>
): { id: string; label: string; detail: string; state: "ok" | "warn" | "bad" }[] {
  const checks: { id: string; label: string; detail: string; state: "ok" | "warn" | "bad" }[] = [];
  const titleLength = title.trim().length;
  checks.push({
    id: "title-length",
    label: "Headline",
    detail:
      titleLength === 0
        ? "not written yet"
        : titleLength <= 60
          ? `${titleLength} characters — fits a search result`
          : titleLength <= 90
            ? `${titleLength} characters — search engines will truncate it`
            : `${titleLength} characters — too long, aim for 60`,
    state: titleLength === 0 ? "bad" : titleLength <= 60 ? "ok" : titleLength <= 90 ? "warn" : "bad",
  });

  const excerptLength = excerpt.trim().length;
  checks.push({
    id: "description",
    label: "Description",
    detail:
      excerptLength === 0
        ? "missing — this is the snippet readers see"
        : excerptLength < 120
          ? `${excerptLength} characters — 120 to 160 reads best`
          : excerptLength <= 300
            ? `${excerptLength} characters`
            : `${excerptLength} characters — trim it under 160`,
    state: excerptLength === 0 ? "bad" : excerptLength < 120 ? "warn" : excerptLength <= 300 ? "ok" : "warn",
  });

  const words = seo.contentLength.words;
  checks.push({
    id: "length",
    label: "Length",
    detail: words === 0 ? "nothing written yet" : `${words} words · ${seo.contentLength.paragraphs} paragraphs`,
    state: words === 0 ? "bad" : words < 300 ? "warn" : "ok",
  });

  checks.push({
    id: "readability",
    label: "Readability",
    detail: words === 0 ? "—" : `${seo.readabilityGrade} (${seo.readabilityScore}/100)`,
    state: words === 0 ? "warn" : seo.readabilityScore >= 60 ? "ok" : "warn",
  });

  const headings = seo.headingStructure.filter((h) => h.level <= 3).length;
  checks.push({
    id: "structure",
    label: "Structure",
    detail: headings === 0 ? "no subheadings — add two or three" : `${headings} subheading${headings === 1 ? "" : "s"}`,
    state: headings === 0 ? "warn" : "ok",
  });

  if (seo.keywordDensity.length > 0) {
    const top = seo.keywordDensity[0]!;
    checks.push({
      id: "keyword",
      label: "Primary keyword",
      detail: `“${top.keyword}” appears ${top.count} times (${top.density}%)${
        top.density > 4 ? " — that reads as stuffing" : ""
      }`,
      state: top.density > 4 ? "warn" : top.density >= 0.5 ? "ok" : "warn",
    });
  }

  checks.push({
    id: "media",
    label: "Media",
    detail:
      seo.imageCount === 0
        ? "no images in the body"
        : `${seo.imageCount} image${seo.imageCount === 1 ? "" : "s"}, ${seo.imagesWithAlt} with alt text`,
    state: seo.imageCount === 0 ? "warn" : seo.imagesWithAlt === seo.imageCount ? "ok" : "warn",
  });

  checks.push({
    id: "links",
    label: "Links",
    detail: `${seo.internalLinks} internal · ${seo.externalLinks} external`,
    state: seo.internalLinks + seo.externalLinks > 0 ? "ok" : "warn",
  });

  checks.push({
    id: "opening",
    label: "Opening paragraph",
    detail: words === 0 ? "—" : seo.firstParagraph.hasKeyword ? "carries the keyword early" : "the keyword is missing from the opening",
    state: words === 0 ? "warn" : seo.firstParagraph.hasKeyword ? "ok" : "warn",
  });

  return checks;
}
