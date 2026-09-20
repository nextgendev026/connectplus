"use client";

import { useState, useCallback, useMemo, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  BrainCircuit,
  Gauge,
  FileText,
  Tag,
  PenLine,
  AlignLeft,
  Lightbulb,
  Clock,
  X,
  Plus,
  ChevronDown,
  Pencil,
  Trash2,
  Loader2,
  AlertCircle,
  Sparkles,
  Wand2,
  Send,
  Menu,
  Check,
} from "lucide-react";
import type { WritingSuggestion } from "@/lib/writing-checks";
import { PILOT_QUICK_ACTIONS, type PilotAction } from "@/lib/brain-pilot";
import { analyzeSeo } from "@/lib/seo-analyzer";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ArticleAssistSummary {
  title: string;
  words: number;
  sections: number;
  repairs: string[];
  degraded: boolean;
}

/**
 * The Article Forge's live state.
 *
 * Lives here rather than in a panel of its own because the forge is a copilot
 * capability, not a screen: the sidebar is where the writer asks for a piece,
 * and the composer's review panel is where it lands.
 */
export interface ArticleAssistState {
  busy: boolean;
  /** "Section 3 of 5 — What the numbers say", or null when idle. */
  progress: string | null;
  error: string | null;
  summary: ArticleAssistSummary | null;
}

/** How long the forge should aim for, as a writer thinks about it. */
const ARTICLE_LENGTHS = [
  { words: 600, label: "Short · ~600 words" },
  { words: 1_200, label: "Standard · ~1,200 words" },
  { words: 1_800, label: "Long read · ~1,800 words" },
];

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface MyPost {
  id: string;
  title: string;
  status: string;
  slug: string;
  updatedAt: string;
  scheduledAt?: string | null;
  moderationStatus?: string | null;
  publishedAt?: string | null;
}

interface CopilotResult {
  action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist" | "seo" | "plagiarism" | "optimize";
  text: string;
  alternatives?: string[];
  meta?: {
    notes?: string[];
    score?: number;
    grade?: string;
    heading?: string;
    tags?: string[];
    wordsBefore?: number;
    wordsAfter?: number;
  };
}

interface AISuggestions {
  tags: string[];
  category: string | null;
  trendingTopics: { title: string; mentions: number }[];
  confidence: number;
}

/**
 * The copilot actions whose answer belongs in a composer field.
 *
 * Everything else — an SEO audit, a plagiarism check, a curation brief, a chat
 * answer — is a report. Reports can be copied, but they are never inserted: a
 * report pasted at the caret reads as a corrupted draft to the writer, and there
 * is no obvious way back from it.
 */
const COPILOT_TEXT_ACTIONS: CopilotResult["action"][] = [
  "rewrite",
  "continue",
  "headline",
  "summarize",
  "tags",
];

const DEFAULT_CATEGORIES = [
  "Technology", "Culture", "Business", "Lifestyle",
  "Sports", "Music", "Food", "Travel",
];

const writingTips = [
  "Start with a compelling hook — your first sentence determines if readers stay.",
  "Use subheadings to break up long sections and guide the reader.",
  "Include specific details: names, dates, and locations add credibility.",
  "Write in active voice for more engaging and direct prose.",
  "End with a clear call to action or thought-provoking question.",
  "Read your piece aloud to catch awkward phrasing and rhythm issues.",
];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface StudioSidebarProps {
  /* Content for AI features */
  title: string;
  content: string;
  /* Tags & categories */
  tags: string[];
  setTags: Dispatch<SetStateAction<string[]>>;
  tagInput: string;
  setTagInput: (v: string) => void;
  handleAddTag: () => void;
  handleRemoveTag: (tag: string) => void;
  handleTagKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  aiSuggestions: AISuggestions | null;
  setAiSuggestions: Dispatch<SetStateAction<AISuggestions | null>>;
  /* Declared as possibly-async so the button can show a real busy state rather
   * than looking inert for the length of a network round-trip. */
  assistWithPost: () => void | Promise<void>;
  /* Category */
  categoryId: string | null;
  setCategoryId: (id: string | null) => void;
  categoryName: string;
  setCategoryName: (name: string) => void;
  categoriesList: Category[];
  categoryOpen: boolean;
  setCategoryOpen: (v: boolean) => void;
  /* Scheduling */
  scheduledFor: string;
  setScheduledFor: (v: string) => void;
  now: number;
  wordCount: number;
  readTime: number;
  /* Stories */
  myStories: MyPost[];
  storiesLoading: boolean;
  storiesUnauth: boolean;
  editingId: string | null;
  openStory: (id: string) => void;
  newStory: () => void;
  deletePost: (id: string) => void;
  /* Brain Pilot — structured edits written straight into the composer */
  /* Copilot */
  copilotBusy: string | null;
  runCopilot: (
    action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist" | "seo" | "plagiarism" | "optimize",
    usePrompt?: boolean
  ) => void;
  copilotPrompt: string;
  setCopilotPrompt: (v: string) => void;
  copilotError: string | null;
  setCopilotError: Dispatch<SetStateAction<string | null>>;
  copilotResult: CopilotResult | null;
  setCopilotResult: Dispatch<SetStateAction<CopilotResult | null>>;
  applyCopilot: (result: CopilotResult) => void;
  /* Live inline writing checks (the Grammarly-shaped copilot) */
  writingChecks: {
    suggestions: WritingSuggestion[];
    score: number;
    grade: string;
    tone: string;
    counts: Record<string, number>;
  } | null;
  checksBusy: boolean;
  applyWritingCheck: (suggestion: WritingSuggestion) => void;
  applyAllWritingChecks: () => void;
  dismissWritingCheck: (id: string) => void;
  excerpt: string;
  /*
   * The Brain Pilot.
   *
   * `runPilot` returns structured *ops*, not text, and every one of them is
   * staged as a diff in the composer before it can land. That review step is
   * why the quick edits live here and the proposal renders over there.
   */
  pilotBusy: PilotAction | null;
  runPilot: (action: PilotAction, instruction?: string) => void;
  /* The Article Forge — one bounded generation per section. */
  article: ArticleAssistState;
  defaultTopic: string;
  onWriteArticle: (topic: string, targetWords: number) => void;
  onUseArticle: () => void;
  onDiscardArticle: () => void;
  /* Error */
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function StudioSidebar(props: StudioSidebarProps) {
  const [railTab, setRailTab] = useState<"ai" | "seo" | "stories">("ai");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  /* On mobile: a floating button opens a full-screen drawer.
     On desktop: always-visible sticky sidebar. */
  return (
    <>
      {/* Mobile trigger button */}
      <button
        onClick={openDrawer}
        data-copilot-open=""
        className="lg:hidden fixed bottom-20 right-4 z-40 flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-accent-coral px-4 py-2.5 text-xs font-semibold text-white shadow-glow-lg hover:scale-105 transition-transform"
      >
        <Menu className="w-4 h-4" />
        Tools
      </button>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={closeDrawer}
          />
          <div className="absolute inset-y-0 right-0 w-full max-w-sm bg-surface-950 border-l border-surface-800 overflow-y-auto animate-in">
            <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-surface-950/90 backdrop-blur-xl border-b border-surface-800/50">
              <span className="text-sm font-semibold text-surface-200">Studio Tools</span>
              <button onClick={closeDrawer} className="p-1.5 rounded-lg text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4">
              <SidebarContent {...props} railTab={railTab} setRailTab={setRailTab} />
            </div>
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:block space-y-4 lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto pr-1 overscroll-contain">
        <SidebarContent {...props} railTab={railTab} setRailTab={setRailTab} />
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Inner content (shared between drawer & desktop)                    */
/* ------------------------------------------------------------------ */

type SidebarContentProps = StudioSidebarProps & {
  railTab: "ai" | "seo" | "stories";
  setRailTab: (t: "ai" | "seo" | "stories") => void;
};

function SidebarContent(props: SidebarContentProps) {
  const {
    railTab, setRailTab,
    title,
    content,
    tags, setTags, tagInput, setTagInput, handleAddTag, handleRemoveTag, handleTagKeyDown,
    assistWithPost,
    aiSuggestions, setAiSuggestions,
    categoryId, setCategoryId, categoryName, setCategoryName, categoriesList,
    categoryOpen, setCategoryOpen,
    scheduledFor, setScheduledFor, now, wordCount, readTime,
    myStories, storiesLoading, storiesUnauth,
    editingId, openStory, newStory, deletePost,
    copilotBusy, runCopilot, copilotPrompt, setCopilotPrompt,
    copilotError, setCopilotError, copilotResult, setCopilotResult, applyCopilot,
    writingChecks, checksBusy, applyWritingCheck, applyAllWritingChecks, dismissWritingCheck,
    excerpt,
    pilotBusy, runPilot,
    article, defaultTopic, onWriteArticle, onUseArticle, onDiscardArticle,
  } = props;

  /* The quick-edit instruction box, the forge's controls, and the local SEO
     audit. All three are view state: nothing here is sent anywhere until the
     writer asks for it. */
  const [editInstruction, setEditInstruction] = useState("");
  const [articleTopic, setArticleTopic] = useState("");
  const [articleWords, setArticleWords] = useState(1_200);
  const seoAudit = useMemo(
    () => buildSeoAudit(title, excerpt, content),
    [title, excerpt, content]
  );

  // Wraps the (async) suggest call so the button can show progress. Previously
  // the click fired a request and the panel rendered nothing at all — no
  // spinner, no result, no error — which is indistinguishable from a dead
  // control, and is exactly how it was reported.
  const [assistBusy, setAssistBusy] = useState(false);
  const runAssist = useCallback(async () => {
    setAssistBusy(true);
    try {
      await assistWithPost();
    } finally {
      setAssistBusy(false);
    }
  }, [assistWithPost]);

  const addSuggestedTag = useCallback(
    (raw: string) => {
      const tag = raw.trim().toLowerCase();
      if (!tag) return;
      setTags((prev) => (prev.length >= 10 || prev.includes(tag) ? prev : [...prev, tag]));
    },
    [setTags]
  );

  return (
    <>
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-xl border border-surface-700/60 bg-surface-900/70 p-1 backdrop-blur-xl">
        {([
          { id: "ai" as const, label: "AI Brain", icon: BrainCircuit },
          { id: "seo" as const, label: "SEO & Tags", icon: Gauge },
          { id: "stories" as const, label: "Stories", icon: FileText },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setRailTab(t.id)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 sm:py-1.5 type-meta transition-all",
              railTab === t.id
                ? "bg-gradient-to-r from-brand-500 to-accent-coral text-white shadow-glow"
                : "text-surface-400 hover:text-surface-50 hover:bg-surface-800"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{t.label}</span>
            <span className="sm:hidden">{t.label.split(" ")[0]}</span>
          </button>
        ))}
      </div>

      {/* ── AI Brain Tab ──────────────────────── */}
      {railTab === "ai" && (
        /* Addressed by tests: this panel is the copilot — the single surface
           that reads the draft and writes back into it. */
        <div className="space-y-4" data-copilot="">
          {/* Live writing checks — issues addressed by range, applied in place */}
          <WritingChecksPanel
            checks={writingChecks}
            busy={checksBusy}
            hasDraft={content.trim().length >= 40}
            onApply={applyWritingCheck}
            onApplyAll={applyAllWritingChecks}
            onDismiss={dismissWritingCheck}
          />

          {/* Brain Copilot */}
          <div className="relative overflow-hidden rounded-2xl bg-surface-900/60 border border-accent-violet/25 p-5 shadow-card">
            <div className="pointer-events-none absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-accent-violet/10 blur-2xl" />
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-accent-violet uppercase tracking-wider flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-violet/30 to-brand-500/20 border border-accent-violet/25">
                  <BrainCircuit className="w-3 h-3 text-accent-violet" />
                </span>
                Brain Copilot
              </h3>
              {copilotBusy && (
                <span className="flex items-center gap-1 type-caption text-accent-violet">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  thinking…
                </span>
              )}
            </div>
            <p className="type-caption text-surface-500 mb-3">
              Reads your draft and writes back into the editor.
            </p>

            {            /*
              The copilot's judgement-level actions.

              These return *text* to read or place by hand: a rewrite to review,
              an outline to follow, an SEO report, a plagiarism check. The
              structured edits — the ones that write into the composer — are the
              Quick edits below, and they land as diffs rather than as prose.
              One panel, one place, one review flow.
            */}
            <div className="grid grid-cols-2 gap-2">
              <CopilotButton
                onClick={() => runCopilot("rewrite")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                busy={copilotBusy === "rewrite"}
                icon={<Gauge className="h-3 w-3 text-brand-400" />}
                label="Polish"
              />
              <CopilotButton
                onClick={() => runCopilot("continue")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                busy={copilotBusy === "continue"}
                icon={<Wand2 className="h-3 w-3 text-accent-cyan" />}
                label="Continue"
              />
              <CopilotButton
                onClick={() => runCopilot("outline")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                busy={copilotBusy === "outline"}
                icon={<FileText className="h-3 w-3 text-accent-amber" />}
                label="Outline"
              />
              <CopilotButton
                onClick={() => runCopilot("summarize")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                busy={copilotBusy === "summarize"}
                icon={<AlignLeft className="h-3 w-3 text-accent-coral" />}
                label="Excerpt"
              />
              <CopilotButton
                onClick={() => runCopilot("headline")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                busy={copilotBusy === "headline"}
                icon={<PenLine className="h-3 w-3 text-brand-400" />}
                label="Headline"
              />
              <CopilotButton
                onClick={() => runCopilot("tags")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                busy={copilotBusy === "tags"}
                icon={<Tag className="h-3 w-3 text-accent-violet" />}
                label="Tags"
              />
              <button
                onClick={() => runCopilot("curate")}
                disabled={copilotBusy !== null}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet/15 to-brand-500/10 border border-accent-violet/25 px-2 py-2 type-caption text-accent-violet hover:from-accent-violet/25 hover:to-brand-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {copilotBusy === "curate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Curate — what to publish next
              </button>
              <button
                onClick={() => runCopilot("seo")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-emerald-500/15 to-brand-500/10 border border-emerald-500/25 px-2 py-2 type-caption text-emerald-300 hover:from-emerald-500/25 hover:to-brand-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {copilotBusy === "seo" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gauge className="h-3 w-3" />}
                SEO
              </button>
              <button
                onClick={() => runCopilot("plagiarism")}
                disabled={copilotBusy !== null || content.trim().length < 20}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-amber-500/15 to-brand-500/10 border border-amber-500/25 px-2 py-2 type-caption text-amber-300 hover:from-amber-500/25 hover:to-brand-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {copilotBusy === "plagiarism" ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertCircle className="h-3 w-3" />}
                Plagiarism
              </button>
              <button
                onClick={() => runCopilot("optimize")}
                disabled={copilotBusy !== null || content.trim().length < 40}
                className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-br from-cyan-500/15 to-brand-500/10 border border-cyan-500/25 px-2 py-2 type-caption text-cyan-300 hover:from-cyan-500/25 hover:to-brand-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                {copilotBusy === "optimize" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                Full Optimize Report
              </button>
            </div>

            {/* Free-form prompt */}
            <div className="mt-3 flex items-end gap-2">
              <textarea
                value={copilotPrompt}
                onChange={(e) => setCopilotPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    runCopilot("assist", true);
                  }
                }}
                placeholder="Ask the brain…"
                rows={2}
                className="flex-1 resize-none rounded-lg bg-surface-800/60 border border-surface-700/50 px-3 py-2 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-accent-violet/40 transition-colors leading-relaxed"
              />
              <button
                onClick={() => runCopilot("assist", true)}
                disabled={copilotBusy !== null || !copilotPrompt.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-violet to-brand-500 text-white shadow-glow hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all"
              >
                {copilotBusy === "assist:prompt" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              </button>
            </div>

            {copilotError && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                <p className="type-caption text-red-300 leading-relaxed flex-1">{copilotError}</p>
                <button onClick={() => setCopilotError(null)} className="text-red-400 hover:text-red-300">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {copilotResult && (
              <div className="mt-3 rounded-lg border border-accent-violet/25 bg-surface-950/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="type-caption text-accent-violet uppercase tracking-wider">
                    {copilotResult.action === "rewrite" ? "Polished draft"
                      : copilotResult.action === "continue" ? "Continued draft"
                      : copilotResult.action === "outline" ? "Outline"
                      : copilotResult.action === "summarize" ? "Excerpt"
                      : copilotResult.action === "headline" ? "Headline"
                      : copilotResult.action === "tags" ? "Tags"
                      : copilotResult.action === "curate" ? "Curation brief"
                      : "Brain answer"}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {copilotResult.meta?.wordsBefore != null && copilotResult.meta?.wordsAfter != null && (
                      <span className="text-[9px] text-surface-500">
                        {copilotResult.meta.wordsBefore} → {copilotResult.meta.wordsAfter} words
                      </span>
                    )}
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(copilotResult.text);
                        setCopilotResult(null);
                      }}
                      className="rounded p-1 text-surface-500 hover:text-brand-300 transition-colors"
                      title="Copy"
                    >
                      <FileText className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => setCopilotResult(null)}
                      className="rounded p-1 text-surface-500 hover:text-surface-300 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <div className="max-h-44 overflow-y-auto rounded-md bg-surface-900/60 border border-surface-800 p-2.5">
                  <p className="type-meta text-surface-200 leading-relaxed whitespace-pre-wrap">{copilotResult.text}</p>
                </div>
                {copilotResult.meta?.notes && copilotResult.meta.notes.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {copilotResult.meta.notes.map((n, i) => (
                      <li key={i} className="flex items-start gap-1.5 type-caption text-surface-400 leading-relaxed">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                        {n}
                      </li>
                    ))}
                  </ul>
                )}
                {copilotResult.alternatives && copilotResult.alternatives.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {copilotResult.alternatives.slice(0, 3).map((alt, i) => (
                      <button
                        key={i}
                        onClick={() => setCopilotResult({ ...copilotResult, text: alt })}
                        className="block w-full text-left rounded-md bg-surface-800/60 border border-surface-700/50 px-2.5 py-1.5 type-caption text-surface-300 hover:border-accent-violet/40 hover:text-accent-violet transition-all"
                      >
                        {alt}
                      </button>
                    ))}
                  </div>
                )}
                {COPILOT_TEXT_ACTIONS.includes(copilotResult.action) ? (
                  <button
                    onClick={() => applyCopilot(copilotResult)}
                    className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet to-brand-500 px-3 py-2 type-meta text-white shadow-glow hover:scale-[1.02] transition-all"
                  >
                    <Wand2 className="h-3 w-3" />
                    {copilotResult.action === "headline" ? "Use as title"
                      : copilotResult.action === "summarize" ? "Use as excerpt"
                      : copilotResult.action === "tags" ? "Add tags"
                      : copilotResult.action === "rewrite" ? "Replace draft"
                      : "Append to draft"}
                  </button>
                ) : (
                  <p className="mt-2.5 rounded-lg border border-surface-800 bg-surface-950/50 px-2.5 py-2 type-caption text-surface-500">
                    This is a report — read it, or copy it above. It never writes into your draft.
                  </p>
                )}
              </div>
            )}
          </div>

          {/*
            Quick edits — the Brain Pilot.

            These return *ops*, not prose, and every op is staged as a diff in
            the composer before it can land. That is what keeps "Tighten" from
            being a button that quietly rewrites a paragraph the writer liked:
            the change arrives as something to read, keep or throw away.
          */}
          <div className="rounded-2xl bg-surface-900/60 border border-accent-violet/20 p-5 shadow-card">
            <h3 className="text-xs font-semibold text-accent-violet uppercase tracking-wider mb-1.5 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-violet/25 to-brand-500/15 border border-accent-violet/20">
                <Wand2 className="w-3 h-3 text-accent-violet" />
              </span>
              Quick edits
            </h3>
            <p className="type-caption text-surface-500 mb-3">
              Rewrites the passage you have selected — or the whole draft when nothing is selected. Every change
              comes back as a diff to keep or discard.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PILOT_QUICK_ACTIONS.filter((a) => a.id !== "ask").map((a) => (
                <button
                  key={a.id}
                  type="button"
                  title={a.hint}
                  disabled={pilotBusy !== null || content.trim().length < 20}
                  onClick={() => runPilot(a.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-accent-violet/25 bg-accent-violet/10 px-2.5 py-1.5 type-caption font-medium text-accent-violet transition-colors hover:bg-accent-violet/20 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {pilotBusy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  {a.label}
                </button>
              ))}
            </div>
            <form
              className="mt-2.5 flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const wanted = editInstruction.trim();
                if (!wanted) return;
                runPilot("ask", wanted);
                setEditInstruction("");
              }}
            >
              <input
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                placeholder="Tell the pilot what to change…"
                aria-label="Instruction for the pilot"
                className="min-w-0 flex-1 rounded-lg border border-surface-700/50 bg-surface-800/60 px-2.5 py-1.5 type-caption text-surface-200 placeholder:text-surface-600 focus:border-accent-violet/40 focus:outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={pilotBusy !== null || !editInstruction.trim() || content.trim().length < 20}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-gradient-to-r from-accent-violet to-brand-500 px-2.5 py-1.5 type-caption font-semibold text-white shadow-glow transition hover:scale-[1.02] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {pilotBusy === "ask" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Ask
              </button>
            </form>
          </div>

          {/*
            The Article Forge.

            A commission, not an edit: it plans the piece, writes every section
            in order (finishing each before starting the next), then stages the
            whole thing — body, headline, excerpt, tags — as four separate diffs
            in the composer. Nothing reaches the draft until the writer says so.
          */}
          <div className="rounded-2xl bg-surface-900/60 border border-accent-coral/20 p-5 shadow-card">
            <h3 className="text-xs font-semibold text-accent-coral uppercase tracking-wider mb-1.5 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-coral/25 to-brand-500/15 border border-accent-coral/20">
                <PenLine className="w-3 h-3 text-accent-coral" />
              </span>
              Write an article
            </h3>
            <p className="type-caption text-surface-500 mb-3">
              Plans the piece, writes it a section at a time — finishing each one before moving on — then hands you
              the headline, draft, excerpt and tags to review.
            </p>
            <div className="flex flex-wrap gap-1.5">
              <input
                value={articleTopic}
                onChange={(e) => setArticleTopic(e.target.value)}
                placeholder={defaultTopic || "What should the article be about?"}
                aria-label="Article topic"
                className="min-w-0 flex-1 rounded-lg border border-surface-700/50 bg-surface-800/60 px-2.5 py-1.5 type-caption text-surface-200 placeholder:text-surface-600 focus:border-accent-coral/40 focus:outline-none transition-colors"
              />
              <select
                value={articleWords}
                onChange={(e) => setArticleWords(Number(e.target.value))}
                aria-label="Article length"
                className="shrink-0 rounded-lg border border-surface-700/50 bg-surface-800/60 px-2 py-1.5 type-caption text-surface-300 focus:border-accent-coral/40 focus:outline-none transition-colors"
              >
                {ARTICLE_LENGTHS.map((l) => (
                  <option key={l.words} value={l.words}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={article.busy || (articleTopic.trim() || defaultTopic).length < 4}
              onClick={() => onWriteArticle(articleTopic.trim() || defaultTopic, articleWords)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-coral/20 to-brand-500/15 border border-accent-coral/25 px-3 py-2 type-caption font-semibold text-accent-coral transition-all hover:from-accent-coral/30 hover:to-brand-500/25 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {article.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              {article.busy ? "Writing…" : "Write the full article"}
            </button>

            {article.busy && article.progress ? (
              <p className="mt-2.5 flex items-center gap-2 type-caption text-accent-coral">
                <Loader2 className="h-3 w-3 animate-spin" />
                {article.progress}
              </p>
            ) : null}

            {article.error ? (
              <p className="mt-2.5 rounded-lg border border-red-500/25 bg-red-500/10 px-2.5 py-2 type-caption text-red-300">
                {article.error}
              </p>
            ) : null}

            {article.summary ? (
              <div className="mt-2.5 rounded-xl border border-surface-800 bg-surface-950/50 p-3">
                <p className="type-meta font-semibold text-surface-200">{article.summary.title}</p>
                <p className="mt-0.5 type-caption text-surface-400">
                  {article.summary.words} words · {article.summary.sections} sections
                  {article.summary.repairs.length > 0
                    ? ` · ${article.summary.repairs.length} repair${article.summary.repairs.length === 1 ? "" : "s"}`
                    : ""}
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

          {/*
            The live SEO audit.

            Deterministic and provider-free, so it can run on every keystroke:
            the numbers a writer sees while typing are instant, free and the same
            on every deployment. The judgement-level work stays on the buttons
            above.
          */}
          <div className="rounded-2xl bg-surface-900/60 border border-accent-cyan/20 p-5 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-accent-cyan uppercase tracking-wider flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-cyan/25 to-brand-500/15 border border-accent-cyan/20">
                  <Gauge className="w-3 h-3 text-accent-cyan" />
                </span>
                SEO audit
              </h3>
              <span className="type-caption font-semibold text-surface-300">
                {seoAudit.score}/100
              </span>
            </div>
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-surface-800">
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300",
                  seoAudit.score >= 75 ? "bg-emerald-500" : seoAudit.score >= 55 ? "bg-amber-500" : "bg-red-500"
                )}
                style={{ width: `${Math.max(3, seoAudit.score)}%` }}
              />
            </div>
            <ul className="space-y-1.5">
              {seoAudit.checks.map((c) => (
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
          </div>

          {/* Writing Tips */}
          <div className="rounded-2xl bg-gradient-to-br from-brand-500/5 to-accent-amber/5 border border-brand-500/10 p-5">
            <h3 className="text-xs font-semibold text-brand-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <Lightbulb className="w-3 h-3" />
              Writing Tips
            </h3>
            <ul className="space-y-3">
              {writingTips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-brand-500/20 flex items-center justify-center text-[9px] font-bold text-brand-400 shrink-0 mt-0.5">
                    {i + 1}
                  </span>
                  <p className="type-meta text-surface-400 leading-relaxed">{tip}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* ── SEO & Tags Tab ────────────────────── */}
      {railTab === "seo" && (
        <div className="space-y-4">
          {/* Status / Meta */}
          <div className="rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5 shadow-card">
            <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-cyan/20 to-brand-500/15 border border-accent-cyan/20">
                <Gauge className="w-3 h-3 text-accent-cyan" />
              </span>
              Status
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-400">Category</span>
                <div className="relative">
                  <button
                    onClick={() => setCategoryOpen(!categoryOpen)}
                    className="flex items-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-3 py-1.5 text-xs text-surface-300 hover:border-surface-500 transition-colors"
                  >
                    {categoryName || "Select category"}
                    <ChevronDown className="w-3 h-3" />
                  </button>
                  {categoryOpen && (
                    <div className="absolute top-full right-0 mt-1 w-44 rounded-xl bg-surface-800 border border-surface-700 shadow-xl z-10 py-1">
                      {categoriesList.length > 0
                        ? categoriesList.map((cat) => (
                            <button
                              key={cat.id}
                              onClick={() => { setCategoryId(cat.id); setCategoryName(cat.name); setCategoryOpen(false); }}
                              className={cn(
                                "w-full text-left px-3 py-2 text-xs transition-colors",
                                categoryId === cat.id ? "text-accent-strong bg-brand-500/10" : "text-surface-400 hover:text-surface-50 hover:bg-surface-700/50"
                              )}
                            >
                              {cat.name}
                            </button>
                          ))
                        : DEFAULT_CATEGORIES.map((cat) => (
                            <button
                              key={cat}
                              onClick={() => { setCategoryName(cat); setCategoryId(null); setCategoryOpen(false); }}
                              className={cn(
                                "w-full text-left px-3 py-2 text-xs transition-colors",
                                categoryName === cat ? "text-accent-strong bg-brand-500/10" : "text-surface-400 hover:text-surface-50 hover:bg-surface-700/50"
                              )}
                            >
                              {cat}
                            </button>
                          ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-400">Words</span>
                <span className="text-xs font-medium text-surface-300">{wordCount}</span>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-surface-400">Schedule publish</span>
                  {scheduledFor && (
                    <button onClick={() => setScheduledFor("")} className="type-caption text-surface-500 hover:text-red-400 transition-colors">
                      Clear
                    </button>
                  )}
                </div>
                <input
                  type="datetime-local"
                  value={scheduledFor}
                  min={now ? new Date(now + 60_000).toISOString().slice(0, 16) : undefined}
                  onChange={(e) => setScheduledFor(e.target.value)}
                  className="w-full bg-surface-800/60 border border-surface-700/50 rounded-lg px-3 py-1.5 text-xs text-surface-300 [color-scheme:dark] focus:outline-none focus:border-brand-500/40 transition-colors"
                />
                {scheduledFor && new Date(scheduledFor).getTime() <= now && (
                  <p className="type-caption text-red-400 mt-1">Choose a future date.</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-surface-400">Read time</span>
                <span className="text-xs font-medium text-surface-300">{readTime} min</span>
              </div>
            </div>
          </div>

          {/* Tags */}
          <div className="rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5 shadow-card">
            <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-accent-violet/20 to-brand-500/15 border border-accent-violet/20">
                <Tag className="w-3 h-3 text-accent-violet" />
              </span>
              Tags
            </h3>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-1 text-xs font-medium text-accent-strong border border-brand-500/20"
                >
                  #{tag}
                  <button onClick={() => handleRemoveTag(tag)} className="hover:text-brand-300 transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Add a tag..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                className="flex-1 bg-surface-900/40 border border-surface-800/50 rounded-xl px-3 py-2 text-sm text-surface-300 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/30 transition-colors"
              />
              <button
                onClick={handleAddTag}
                disabled={!tagInput.trim() || tags.length >= 10}
                className="p-2 rounded-lg bg-surface-800/60 border border-surface-700/50 text-surface-400 hover:text-accent-strong hover:border-brand-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={runAssist}
                disabled={assistBusy}
                className="p-2 rounded-lg bg-surface-800/60 border border-brand-500/20 text-accent-strong hover:text-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                title="AI assist — suggest tags & category"
                aria-label="AI assist — suggest tags and category"
              >
                {assistBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Lightbulb className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className="type-caption text-surface-600 mt-2">Press Enter to add · {tags.length}/10 tags</p>

            {/* The suggestion result panel.
             *
             * This is the piece that was missing: the lightbulb ran the whole
             * analysis — keyword extraction, tag and category inference, a live
             * trends fetch — and wrote it into state that no component ever
             * read. Wiring it here is what turns the control from "does
             * nothing" into an assistant, and every value on screen is one the
             * writer can act on with a single tap. */}
            {aiSuggestions && (
              <div className="mt-3 rounded-xl border border-brand-500/20 bg-brand-500/[0.06] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 type-meta font-semibold text-accent-strong">
                    <Sparkles className="h-3 w-3" />
                    Suggestions
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="type-caption text-surface-500">
                      {Math.round(aiSuggestions.confidence * 100)}% match
                    </span>
                    <button
                      onClick={() => setAiSuggestions(null)}
                      className="p-1 rounded text-surface-500 hover:text-surface-200 transition-colors"
                      title="Dismiss suggestions"
                      aria-label="Dismiss suggestions"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                </div>

                {aiSuggestions.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {aiSuggestions.tags.map((t) => {
                      const tag = t.trim().toLowerCase();
                      const already = tags.includes(tag);
                      const full = tags.length >= 10;
                      return (
                        <button
                          key={t}
                          onClick={() => addSuggestedTag(t)}
                          disabled={already || full}
                          className="rounded-full border border-brand-500/25 bg-surface-800/60 px-2 py-1 type-caption font-medium text-surface-300 hover:border-brand-500/50 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          title={
                            already
                              ? "Already applied"
                              : full
                                ? "Tag limit reached (10)"
                                : `Add "${tag}"`
                          }
                        >
                          {already ? "✓" : "+"} {tag}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="type-caption text-surface-500">
                    Write a little more and the tags will get sharper.
                  </p>
                )}

                {aiSuggestions.category && aiSuggestions.category !== categoryName && (
                  <button
                    onClick={() => {
                      const wanted = aiSuggestions.category?.toLowerCase();
                      const match = categoriesList.find((c) => c.name.toLowerCase() === wanted);
                      if (match) {
                        setCategoryId(match.id);
                        setCategoryName(match.name);
                      } else {
                        setCategoryName(aiSuggestions.category as string);
                      }
                    }}
                    className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border border-surface-700/60 bg-surface-900/50 px-2.5 py-1.5 type-caption text-surface-300 hover:border-brand-500/40 hover:text-accent-strong transition-all"
                  >
                    <span className="truncate">Use category: {aiSuggestions.category}</span>
                    <Check className="h-3 w-3 shrink-0" />
                  </button>
                )}

                {aiSuggestions.trendingTopics.length > 0 && (
                  <div className="mt-3 border-t border-surface-800/60 pt-2">
                    <p className="type-caption text-surface-500 mb-1.5">
                      Trending now — tap to tag
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {aiSuggestions.trendingTopics.map((topic) => (
                        <button
                          key={topic.title}
                          onClick={() => addSuggestedTag(topic.title)}
                          disabled={tags.length >= 10}
                          className="rounded-full border border-surface-700/60 bg-surface-800/40 px-2 py-0.5 type-caption text-surface-400 hover:border-accent-coral/40 hover:text-accent-coral disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                          title={`${topic.mentions} published ${topic.mentions === 1 ? "story" : "stories"} under this topic`}
                        >
                          {topic.title}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Stories Tab ────────────────────────── */}
      {railTab === "stories" && (
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500/25 to-accent-coral/15 border border-brand-500/20">
                  <FileText className="w-3 h-3 text-accent-strong" />
                </span>
                My Stories
              </h3>
              <button
                onClick={newStory}
                className="rounded-full bg-gradient-to-r from-brand-500/15 to-accent-coral/10 border border-brand-500/25 px-2.5 py-1 type-meta text-accent-strong hover:bg-brand-500/25 transition-all"
              >
                + New
              </button>
            </div>

            {storiesLoading ? (
              <div className="space-y-2 py-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-xl bg-surface-800/40 animate-pulse" />
                ))}
              </div>
            ) : storiesUnauth ? (
              <Link
                href="/auth/signin?callbackUrl=/studio"
                className="text-xs font-medium text-accent-strong hover:text-brand-700 transition-colors"
              >
                Sign in to manage your stories
              </Link>
            ) : myStories.length === 0 ? (
              <p className="text-xs text-surface-600 py-2">No stories yet — start writing above.</p>
            ) : (
              <ul className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {myStories.map((post) => (
                  <li key={post.id}>
                    <div
                      className={cn(
                        "group flex items-center gap-2 rounded-xl border p-2.5 transition-colors",
                        editingId === post.id
                          ? "border-brand-500/40 bg-brand-500/10"
                          : "border-surface-800/60 bg-surface-900/40 hover:border-surface-700"
                      )}
                    >
                      <button onClick={() => openStory(post.id)} className="flex-1 min-w-0 text-left" title={post.title}>
                        <p className="truncate text-xs font-medium text-surface-200 group-hover:text-brand-300 transition-colors">
                          {post.title}
                        </p>
                        <p className="type-caption text-surface-500 mt-0.5">
                          {post.status === "PUBLISHED" ? "Published" : post.scheduledAt ? "Scheduled" : "Draft"} ·{" "}
                          {post.scheduledAt
                            ? new Date(post.scheduledAt).toLocaleDateString()
                            : timeAgo(post.updatedAt)}
                        </p>
                        {post.status === "PUBLISHED" && post.moderationStatus === "PENDING" && (
                          <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 type-caption text-amber-300">
                            <Clock className="h-2.5 w-2.5" />
                            In review
                          </p>
                        )}
                      </button>
                      <button
                        onClick={() => openStory(post.id)}
                        className="p-1.5 rounded-lg text-surface-500 hover:text-brand-400 hover:bg-surface-800 transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => deletePost(post.id)}
                        className="p-1.5 rounded-lg text-surface-500 hover:text-red-400 hover:bg-surface-800 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Small helper components                                            */
/* ------------------------------------------------------------------ */

/**
 * The live checks panel.
 *
 * Reads as Grammarly's card, not a report: the score tells the writer how the
 * draft is doing at a glance, and each issue is a one-tap fix. Issues that
 * carry a `replacement` get an Apply button; the judgement-only ones get a
 * Dismiss so the list can be cleared without pretending they were fixed.
 */
function WritingChecksPanel({
  checks,
  busy,
  hasDraft,
  onApply,
  onApplyAll,
  onDismiss,
}: {
  checks: StudioSidebarProps["writingChecks"];
  busy: boolean;
  hasDraft: boolean;
  onApply: (suggestion: WritingSuggestion) => void;
  onApplyAll: () => void;
  onDismiss: (id: string) => void;
}) {
  const fixable = checks?.suggestions.filter((s) => s.replacement !== null) ?? [];
  const score = checks?.score ?? 100;

  return (
    <div className="relative overflow-hidden rounded-2xl bg-surface-900/60 border border-emerald-500/25 p-5 shadow-card">
      <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-emerald-500/10 blur-2xl" />
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-emerald-300 uppercase tracking-wider flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/30 to-brand-500/20 border border-emerald-500/25">
            <Check className="w-3 h-3 text-emerald-300" />
          </span>
          Writing checks
        </h3>
        {busy ? (
          <span className="flex items-center gap-1 type-caption text-surface-500">
            <Loader2 className="h-3 w-3 animate-spin" />
            checking…
          </span>
        ) : checks ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 type-caption font-semibold",
              checks.score >= 90 ? "bg-emerald-500/15 text-emerald-300" : checks.score >= 75 ? "bg-brand-500/15 text-brand-300" : "bg-amber-500/15 text-amber-300"
            )}
          >
            {checks.grade} · {checks.score}
          </span>
        ) : null}
      </div>

      {!hasDraft ? (
        <p className="type-caption text-surface-500">
          Write a sentence or two and the copilot starts checking as you go.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 rounded-full bg-surface-800">
              <div
                className={cn(
                  "h-1.5 rounded-full transition-all duration-500",
                  score >= 90 ? "bg-emerald-500" : score >= 75 ? "bg-brand-500" : score >= 60 ? "bg-amber-500" : "bg-red-500"
                )}
                style={{ width: `${score}%` }}
              />
            </div>
            {checks ? <span className="type-caption text-surface-400">{checks.tone}</span> : null}
          </div>

          {checks && checks.suggestions.length === 0 ? (
            <p className="mt-3 type-meta text-emerald-400">No issues found — this draft reads clean.</p>
          ) : null}

          {checks && checks.suggestions.length > 0 ? (
            <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-0.5">
              {checks.suggestions.slice(0, 12).map((s) => (
                <li key={s.id} className="rounded-lg border border-surface-800 bg-surface-950/40 p-2.5">
                  <div className="flex items-start gap-2">
                    <span
                      className={cn(
                        "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                        s.kind === "correctness" ? "bg-red-500/15 text-red-300"
                          : s.kind === "clarity" ? "bg-brand-500/15 text-brand-300"
                          : s.kind === "engagement" ? "bg-accent-violet/15 text-accent-violet"
                          : "bg-surface-700/60 text-surface-300"
                      )}
                    >
                      {s.kind}
                    </span>
                    <p className="type-meta flex-1 text-surface-300 leading-relaxed">{s.message}</p>
                    <button
                      onClick={() => onDismiss(s.id)}
                      title="Dismiss"
                      className="shrink-0 rounded p-0.5 text-surface-600 hover:text-surface-300 transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  {s.replacement !== null ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate rounded bg-red-500/10 px-1.5 py-0.5 type-caption text-red-300 line-through">
                        {s.original}
                      </span>
                      <span className="shrink-0 text-surface-600">→</span>
                      <span className="min-w-0 flex-1 truncate rounded bg-emerald-500/10 px-1.5 py-0.5 type-caption text-emerald-300">
                        {s.replacement}
                      </span>
                      <button
                        onClick={() => onApply(s)}
                        className="shrink-0 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 type-caption font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {fixable.length > 1 ? (
            <button
              onClick={onApplyAll}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500/15 to-brand-500/10 border border-emerald-500/25 px-2 py-2 type-caption text-emerald-300 hover:from-emerald-500/25 hover:to-brand-500/15 transition-all"
            >
              <Wand2 className="h-3 w-3" />
              Fix all {fixable.length}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function CopilotButton({
  onClick,
  disabled,
  busy,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : icon}
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
export function buildSeoAudit(
  title: string,
  excerpt: string,
  content: string
): { score: number; grade: string; checks: { id: string; label: string; detail: string; state: "ok" | "warn" | "bad" }[] } {
  const seo = analyzeSeo(title, content, excerpt);
  const checks: { id: string; label: string; detail: string; state: "ok" | "warn" | "bad" }[] = [];
  const words = seo.contentLength.words;

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

  return { score: seo.score, grade: seo.grade, checks };
}
