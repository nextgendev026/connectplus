"use client";

import { useState, useCallback, type Dispatch, type SetStateAction } from "react";
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
  ChevronRight,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

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

interface GeneratedResult {
  type: string;
  primary: string;
  alternatives: string[];
}

interface EnhancementResult {
  score: number;
  grade: string;
  readability: {
    sentences: number;
    words: number;
    avgSentenceWords: number;
    longSentenceCount: number;
  };
  suggestions: { kind: string; message: string }[];
}

interface CopilotResult {
  action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist";
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
  assistWithPost: () => void;
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
  /* AI generate */
  genBusy: null | "headline" | "excerpt" | "topics";
  generateAssist: (type: "headline" | "excerpt" | "topics") => void;
  generated: GeneratedResult | null;
  setGenerated: Dispatch<SetStateAction<GeneratedResult | null>>;
  applyGenerated: (value: string) => void;
  /* Enhancement */
  enhanceBusy: boolean;
  runEnhance: () => void;
  enhancement: EnhancementResult | null;
  setEnhancement: Dispatch<SetStateAction<EnhancementResult | null>>;
  /* Copilot */
  copilotBusy: string | null;
  runCopilot: (
    action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist",
    usePrompt?: boolean
  ) => void;
  copilotPrompt: string;
  setCopilotPrompt: (v: string) => void;
  copilotError: string | null;
  setCopilotError: Dispatch<SetStateAction<string | null>>;
  copilotResult: CopilotResult | null;
  setCopilotResult: Dispatch<SetStateAction<CopilotResult | null>>;
  applyCopilot: (result: CopilotResult) => void;
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
    title, content,
    tags, setTags, tagInput, setTagInput, handleAddTag, handleRemoveTag, handleTagKeyDown,
    aiSuggestions, setAiSuggestions, assistWithPost,
    categoryId, setCategoryId, categoryName, setCategoryName, categoriesList,
    categoryOpen, setCategoryOpen,
    scheduledFor, setScheduledFor, now, wordCount, readTime,
    myStories, storiesLoading, storiesUnauth,
    editingId, openStory, newStory, deletePost,
    genBusy, generateAssist, generated, setGenerated, applyGenerated,
    enhanceBusy, runEnhance, enhancement, setEnhancement,
    copilotBusy, runCopilot, copilotPrompt, setCopilotPrompt,
    copilotError, setCopilotError, copilotResult, setCopilotResult, applyCopilot,
  } = props;

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
        <div className="space-y-4">
          {/* AI Content Studio */}
          <div className="relative overflow-hidden rounded-2xl bg-surface-900/60 border border-brand-500/20 p-5 shadow-card">
            <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-brand-500/10 blur-2xl" />
            <h3 className="text-xs font-semibold text-accent-strong uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-r from-brand-500 to-accent-coral shadow-glow">
                <Sparkles className="w-3 h-3 text-white" />
              </span>
              AI Content Studio
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <SidebarButton
                onClick={() => generateAssist("headline")}
                disabled={genBusy !== null || content.trim().length < 40}
                busy={genBusy === "headline"}
                icon={<PenLine className="h-3.5 w-3.5" />}
                label="Headline"
              />
              <SidebarButton
                onClick={() => generateAssist("excerpt")}
                disabled={genBusy !== null || content.trim().length < 40}
                busy={genBusy === "excerpt"}
                icon={<AlignLeft className="h-3.5 w-3.5" />}
                label="Excerpt"
              />
              <SidebarButton
                onClick={() => generateAssist("topics")}
                disabled={genBusy !== null || content.trim().length < 40}
                busy={genBusy === "topics"}
                icon={<Tag className="h-3.5 w-3.5" />}
                label="Topics"
              />
            </div>

            <button
              onClick={runEnhance}
              disabled={enhanceBusy || content.trim().length < 40}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500/15 to-accent-coral/10 border border-brand-500/25 px-2 py-2 type-caption text-accent-strong hover:from-brand-500/25 hover:to-accent-coral/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {enhanceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
              {enhanceBusy ? "Analyzing…" : "Enhance — readability & clarity"}
            </button>

            {/* Enhancement results */}
            {enhancement && (
              <div className="mt-3 rounded-lg border border-surface-700/60 bg-surface-950/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="type-caption text-surface-400 uppercase tracking-wider">
                    Grade {enhancement.grade}
                  </span>
                  <button onClick={() => setEnhancement(null)} className="text-surface-500 hover:text-surface-300">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-surface-800">
                    <div
                      className={cn(
                        "h-1.5 rounded-full transition-all",
                        enhancement.score >= 75 ? "bg-emerald-500" : enhancement.score >= 50 ? "bg-amber-500" : "bg-red-500"
                      )}
                      style={{ width: `${enhancement.score}%` }}
                    />
                  </div>
                  <span className="type-caption text-surface-300">{enhancement.score}/100</span>
                </div>
                <p className="mt-2 type-caption text-surface-500">
                  {enhancement.readability.sentences} sentences · {enhancement.readability.words} words
                </p>
                {enhancement.suggestions.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {enhancement.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5 type-meta text-surface-300 leading-relaxed">
                        <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                        {s.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 type-meta text-emerald-400">Clean draft — no suggestions. Nice.</p>
                )}
              </div>
            )}

            {/* Generated results */}
            {generated && (
              <div className="mt-3 space-y-2 rounded-lg border border-surface-700/60 bg-surface-950/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="type-caption text-surface-400 uppercase tracking-wider">
                    {generated.type} suggestions
                  </span>
                  <button onClick={() => setGenerated(null)} className="text-surface-500 hover:text-surface-300">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <button
                  onClick={() => applyGenerated(generated.primary)}
                  className="block w-full text-left rounded-md bg-brand-500/10 border border-brand-500/20 px-3 py-2 text-xs text-brand-200 hover:bg-brand-500/20 transition-all"
                >
                  {generated.primary}
                </button>
                {generated.alternatives.map((alt, i) => (
                  <button
                    key={i}
                    onClick={() => applyGenerated(alt)}
                    className="block w-full text-left rounded-md bg-surface-800/60 border border-surface-700/50 px-3 py-2 text-xs text-surface-300 hover:border-brand-500/30 hover:text-brand-300 transition-all"
                  >
                    {alt}
                  </button>
                ))}
                <p className="text-[9px] text-surface-600">Click a suggestion to apply it.</p>
              </div>
            )}
          </div>

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
                <button
                  onClick={() => applyCopilot(copilotResult)}
                  className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet to-brand-500 px-3 py-2 type-meta text-white shadow-glow hover:scale-[1.02] transition-all"
                >
                  <Wand2 className="h-3 w-3" />
                  {copilotResult.action === "headline" ? "Use as title"
                    : copilotResult.action === "summarize" ? "Use as excerpt"
                    : copilotResult.action === "tags" ? "Add tags"
                    : copilotResult.action === "rewrite" ? "Replace draft"
                    : copilotResult.action === "continue" ? "Append to draft"
                    : "Insert into editor"}
                </button>
              </div>
            )}
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
                onClick={assistWithPost}
                className="p-2 rounded-lg bg-surface-800/60 border border-brand-500/20 text-accent-strong hover:text-brand-700 transition-all"
                title="AI assist — suggest tags & category"
              >
                <Lightbulb className="h-3.5 w-3.5" />
              </button>
            </div>
            <p className="type-caption text-surface-600 mt-2">Press Enter to add · {tags.length}/10 tags</p>
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

function SidebarButton({
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
      className="flex flex-col items-center gap-1 rounded-lg bg-surface-800/60 border border-brand-500/20 px-2 py-2.5 type-caption text-accent-strong hover:bg-brand-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </button>
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
