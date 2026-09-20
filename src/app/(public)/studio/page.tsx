"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { extractKeywords } from "@/lib/neural-text";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { ArrowLeft, Eye, EyeOff, Upload, Loader2, X, PenLine, AlertCircle, Clock, AlignLeft, Wand2 } from "lucide-react";
import { StudioToolbar } from "@/components/studio/StudioToolbar";
import { StudioPreview } from "@/components/studio/StudioPreview";
import { StudioSidebar, type ArticleAssistState } from "@/components/studio/StudioSidebar";
import { CheckedEditor } from "@/components/studio/CheckedEditor";
import { applySuggestion, applySuggestions, type WritingSuggestion } from "@/lib/writing-checks";
import {
  applyPilotOps,
  reviewPilotEdits,
  PILOT_OP_FIELD,
  type PilotAction,
  type PilotComposerState,
  type PilotEditReview,
  type PilotOp,
} from "@/lib/brain-pilot";
import { PilotReview } from "@/components/studio/PilotReview";
import { forgeArticle, type ArticleAsk, type ForgedArticle } from "@/lib/article-forge";
import type { EditorRange } from "@/components/studio/CheckedEditor";

const AUTOSAVE_MS = 4000;
const BACKUP_KEY = "connectplus:studio:new";
interface Category { id: string; name: string; slug: string; }
interface MyPost { id: string; title: string; status: string; slug: string; updatedAt: string; scheduledAt?: string | null; moderationStatus?: string | null; publishedAt?: string | null; }

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h ago";
  return Math.floor(hours / 24) + "d ago";
}

function dateToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
}

function parseTagList(value: string): string[] {
  return value.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean).slice(0, 10);
}

export default function StudioPage() {
  const router = useRouter();
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const { data: session } = useSession();
  // Publishing no longer requires email verification — accounts are trusted
  // as verified (sign-up emails on this deployment are not live inboxes).
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [myStories, setMyStories] = useState<MyPost[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storiesUnauth, setStoriesUnauth] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{ tags: string[]; category: string | null; trendingTopics: { title: string; mentions: number }[]; confidence: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  /* The Brain Pilot. `busy` holds the action in flight so the right button
     spins; the notice carries what was applied and a one-tap undo. */
  const [pilotBusy, setPilotBusy] = useState<PilotAction | null>(null);
  const [pilotNotice, setPilotNotice] = useState<{ message: string; undo: (() => void) | null } | null>(null);
  const [selectionRange, setSelectionRange] = useState<EditorRange>({ selectionStart: 0, selectionEnd: 0, cursor: 0, hasSelection: false });
  /**
   * The pending proposal under review.
   *
   * `base` is the composer as it stands *after* every edit kept so far, which is
   * what the remaining diffs are computed against; `origin` is where the reply
   * started, so one undo rewinds the whole reply rather than one increment.
   */
  const [pilotReview, setPilotReview] = useState<{
    action: PilotAction;
    reply: string;
    ranges: EditorRange;
    base: PilotComposerState;
    origin: PilotComposerState;
    pending: PilotOp[];
    reviews: PilotEditReview[];
  } | null>(null);
  const reviewRef = useRef<HTMLDivElement | null>(null);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  /*
   * The Article Forge.
   *
   * The generated piece is held in a ref, not in state: it is a document, not a
   * view, and nothing renders it until the writer asks to put it in the
   * composer. Only its summary lives in state, so a 1,200-word draft does not
   * re-render the page on every progress tick.
   */
  const [article, setArticle] = useState<ArticleAssistState>({
    busy: false,
    progress: null,
    error: null,
    summary: null,
  });
  const forgedRef = useRef<ForgedArticle | null>(null);
  const [copilotBusy, setCopilotBusy] = useState<string | null>(null);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotResult, setCopilotResult] = useState<{ action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist" | "seo" | "plagiarism" | "optimize"; text: string; alternatives?: string[]; meta?: { notes?: string[]; score?: number; grade?: string; heading?: string; tags?: string[]; wordsBefore?: number; wordsAfter?: number } } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  /*
   * Live inline checks — the Grammarly-shaped half of the copilot.
   *
   * The brain already reads the composer on demand (title/content/selection);
   * this reads it *continuously*, on a debounce, and hands back issues addressed
   * by character offset. The composer then applies a fix to the exact range, so
   * a change lands where the writer is looking instead of replacing the draft.
   */
  const [writingChecks, setWritingChecks] = useState<{
    suggestions: WritingSuggestion[];
    score: number;
    grade: string;
    tone: string;
    counts: Record<string, number>;
  } | null>(null);
  const [checksBusy, setChecksBusy] = useState(false);
  const checksSeq = useRef(0);
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  useEffect(() => {
    if (showPreview || content.trim().length < 40) {
      setWritingChecks(null);
      setChecksBusy(false);
      return;
    }
    // Sequence-stamped so a slow response for an old draft can never overwrite
    // the checks for the text now on screen.
    const seq = ++checksSeq.current;
    const timer = setTimeout(async () => {
      setChecksBusy(true);
      try {
        const res = await fetch("/api/ai/studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ action: "inspect", content, title, excerpt, tags, category: categoryName }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (checksSeq.current !== seq || !mountedRef.current) return;
        setWritingChecks({
          suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
          score: data.meta?.score ?? 100,
          grade: data.meta?.grade ?? "A",
          tone: data.meta?.tone ?? "Neutral",
          counts: data.meta?.counts ?? {},
        });
      } catch {
        // A failed check is silent: the editor keeps working, the panel simply
        // does not update. Nothing about writing should depend on the network.
      } finally {
        if (checksSeq.current === seq && mountedRef.current) setChecksBusy(false);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [content, title, excerpt, tags, categoryName, showPreview]);

  /**
   * Tell the brain what the writer decided.
   *
   * Fire-and-forget on purpose: the important half of the interaction is the
   * edit landing in the draft, and a writer must never wait on telemetry — or
   * see it fail. The outcomes are what the pilot learns from, so they are sent
   * in one small batch per decision rather than held in a queue that a refresh
   * would lose.
   */
  const recordDecisions = useCallback(
    (outcomes: { action: string; kind: "kept" | "discarded" | "fix" | "article" | "empty"; field?: string; opKind?: string; edits?: number }[]) => {
      if (outcomes.length === 0) return;
      void fetch("/api/ai/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "learn", outcomes }),
      }).catch(() => {});
    },
    []
  );

  /** Apply one inline fix to its exact range, then let the debounce re-check. */
  const applyWritingCheck = useCallback((suggestion: WritingSuggestion) => {
    setContent((prev) => applySuggestion(prev, suggestion));
    // Applied fixes shift every later offset, so the remaining suggestions are
    // dropped rather than applied against stale ranges; the debounce refills.
    setWritingChecks((prev) => (prev ? { ...prev, suggestions: [] } : prev));
    // The kind of correction a writer accepts in place is the clearest signal
    // available about what this publication's prose keeps getting wrong.
    recordDecisions([{ action: "inspect", kind: "fix", field: "content", opKind: suggestion.kind }]);
  }, [recordDecisions]);

  const applyAllWritingChecks = useCallback(() => {
    const applied = writingChecks?.suggestions.filter((s) => s.replacement !== null) ?? [];
    setContent((prev) => (writingChecks ? applySuggestions(prev, writingChecks.suggestions) : prev));
    setWritingChecks((prev) => (prev ? { ...prev, suggestions: [] } : prev));
    recordDecisions(
      applied.map((s) => ({ action: "inspect", kind: "fix" as const, field: "content", opKind: s.kind }))
    );
  }, [writingChecks, recordDecisions]);

  const dismissWritingCheck = useCallback((id: string) => {
    setWritingChecks((prev) =>
      prev ? { ...prev, suggestions: prev.suggestions.filter((s) => s.id !== id) } : prev
    );
  }, []);

  const loadCategories = useCallback(async () => {
    try { const res = await fetch("/api/posts?limit=100"); const data = await res.json(); if (!data?.posts) return; const map = new Map<string, Category>(); for (const post of data.posts) { if (post.category && !map.has(post.category.id)) map.set(post.category.id, post.category); } setCategoriesList(Array.from(map.values())); } catch {}
  }, []);

  const loadMyStories = useCallback(async () => {
    setStoriesLoading(true);
    try { const res = await fetch("/api/posts?mine=true&limit=50"); if (res.status === 401) { setStoriesUnauth(true); setMyStories([]); return; } const data = await res.json(); if (!data?.posts) return; setMyStories(data.posts.map((p: any) => ({ id: p.id, title: p.title, status: p.status, slug: p.slug, updatedAt: p.updatedAt, scheduledAt: p.scheduledAt ?? null, moderationStatus: p.moderationStatus ?? null, publishedAt: p.publishedAt ?? null }))); setStoriesUnauth(false); } catch { setStoriesUnauth(false); } finally { if (mountedRef.current) setStoriesLoading(false); }
  }, []);

  useEffect(() => {
    loadCategories(); loadMyStories();
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId) { fetch("/api/posts/" + editId).then((r) => (r.ok ? r.json() : null)).then((d) => { if (!d?.post || cancelled) return; setEditingId(editId); setTitle(d.post.title ?? ""); setContent(d.post.content ?? ""); setExcerpt(d.post.excerpt ?? ""); setCoverImage(d.post.coverImage ?? null); setTags((d.post.tags ?? []).map((t: any) => t.slug)); if (d.post.category) { setCategoryId(d.post.category.id); setCategoryName(d.post.category.name); } setEditStatus(d.post.status ?? null); setScheduledFor(dateToLocalInput(d.post.scheduledAt)); }).catch(() => {}); } else { const backup = localStorage.getItem(BACKUP_KEY); if (backup) { try { const saved = JSON.parse(backup); if (saved && typeof saved === "object") { if (saved.title) setTitle(saved.title); if (saved.content) setContent(saved.content); if (saved.excerpt) setExcerpt(saved.excerpt); if (Array.isArray(saved.tags)) setTags(saved.tags); if (saved.categoryId) setCategoryId(saved.categoryId); if (saved.coverImage) setCoverImage(saved.coverImage); } } catch {} } }
    return () => { cancelled = true; };
  }, [loadCategories, loadMyStories]);

  useEffect(() => { const t = setTimeout(() => { try { localStorage.setItem(BACKUP_KEY, JSON.stringify({ title, content, excerpt, tags, categoryId, coverImage, ts: Date.now() })); } catch {} }, 800); return () => clearTimeout(t); }, [title, content, excerpt, tags, categoryId, coverImage]);

  const savePost = useCallback(async (status: "PUBLISHED" | "DRAFT") => {
    if (mountedRef.current) setSaving(true);
    try {
      const matchedCategory = categoriesList.find((c) => c.id === categoryId || c.name === categoryName);
      const payload = { title: title.trim(), content: content.trim(), excerpt: excerpt.trim() || null, coverImage, categoryId: matchedCategory?.id ?? null, tags, status, scheduledAt: status === "DRAFT" && scheduledFor ? new Date(scheduledFor).toISOString() : null };
      let postId = editingId;
      if (!postId) { const res = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (res.status === 401) { router.push("/auth/signin"); return null; } if (!res.ok) { const err = await res.json().catch(() => ({ error: "Save failed" })); throw new Error(err.error || "Failed to save"); } const data = await res.json(); postId = data?.post?.id; if (postId) setEditingId(postId); } else { const res = await fetch("/api/posts/" + postId, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }); if (res.status === 401) { router.push("/auth/signin"); return null; } if (!res.ok) { const err = await res.json().catch(() => ({ error: "Save failed" })); throw new Error(err.error || "Failed to save"); } }
      setLastSaved(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
      return postId;
    } finally { if (mountedRef.current) setSaving(false); }
  }, [title, content, excerpt, coverImage, categoryId, categoryName, categoriesList, tags, editingId, router, scheduledFor]);

  const canAutoSave = (title.trim().length > 0 || content.trim().length > 0) && !showPreview;
  useEffect(() => { if (!canAutoSave) return; let active = true; const timer = setTimeout(async () => { try { await savePost("DRAFT"); } catch {} if (active) loadMyStories(); }, AUTOSAVE_MS); return () => { active = false; clearTimeout(timer); }; }, [title, content, excerpt, coverImage, tags, categoryId, categoryName, canAutoSave, savePost, loadMyStories]);

  const handleAddTag = useCallback(() => { const trimmed = tagInput.trim().toLowerCase(); if (trimmed && !tags.includes(trimmed) && tags.length < 10) { setTags((prev) => [...prev, trimmed]); setTagInput(""); } }, [tagInput, tags]);
  const handleRemoveTag = useCallback((tag: string) => { setTags((prev) => prev.filter((t) => t !== tag)); }, []);
  const handleTagKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag(); } }, [handleAddTag]);

  const insertMarkdown = useCallback((before: string, after: string, hint: string) => {
    const ta = contentRef.current; if (!ta) return;
    const start = ta.selectionStart ?? 0; const end = ta.selectionEnd ?? 0;
    const selected = ta.value.slice(start, end); const wrapped = selected || hint;
    const next = ta.value.slice(0, start) + before + wrapped + after + ta.value.slice(end);
    setContent(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + before.length, start + before.length + wrapped.length); });
  }, []);

  const assistWithPost = useCallback(async () => {
    const textForAnalysis = (title + " " + content).trim();
    if (textForAnalysis.length < 20) { setAiSuggestions({ tags: [], category: null, trendingTopics: [], confidence: 0 }); return; }
    const keywords = extractKeywords(textForAnalysis, 10);
    const suggestedTags = keywords.slice(0, 5).map((k) => k.keyword);
    let suggestedCategory: string | null = null;
    if (keywords.some((k) => k.keyword.toLowerCase().includes("tech"))) suggestedCategory = "Technology";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("culture"))) suggestedCategory = "Culture";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("business"))) suggestedCategory = "Business";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("food"))) suggestedCategory = "Food";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("travel"))) suggestedCategory = "Travel";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("sports"))) suggestedCategory = "Sports";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("music"))) suggestedCategory = "Music";
    else if (keywords.some((k) => k.keyword.toLowerCase().includes("lifestyle"))) suggestedCategory = "Lifestyle";
    // Real topics from the public endpoint the reader-facing sidebar uses — the
    // same data the admin console now reads, so the three surfaces can never
    // disagree. This previously called an admin-only route and then threw the
    // response away in favour of two hardcoded strings, so the panel offered
    // writers "trending" topics with invented mention counts, and non-admins
    // simply got a 403 they never saw.
    let trendingTopics: { title: string; mentions: number }[] = [];
    try {
      const res = await fetch("/api/trending/topics?limit=5", {
        credentials: "omit",
        headers: { "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const data = await res.json();
        trendingTopics = ((data?.topics ?? []) as { name: string; postCount: number }[]).map((t) => ({
          title: t.name,
          // Stories filed under the topic — the honest reading of the number.
          mentions: t.postCount,
        }));
      }
    } catch {}
    setAiSuggestions({ tags: suggestedTags, category: suggestedCategory, trendingTopics, confidence: Math.min(keywords.length / 10, 1) });
  }, [title, content]);

  /**
   * Apply a pilot reply to the composer.
   *
   * The ranges travel *with* the ops because they were measured before the
   * request went out — a rewrite of a passage must land on that passage, not on
   * whatever the caret happens to be resting on by the time the model answers.
   * The whole previous state is captured for undo, because a rewrite the writer
   * disagrees with should cost one tap, not a re-type.
   */
  /**
   * Write a resolved composer state back into the four fields, with one-tap undo.
   *
   * Every pilot path goes through here, so the undo is the same gesture whether
   * the writer kept one edit or all of them: the notice describes what landed and
   * restores the draft from *before the first edit of that reply*, not from a
   * snapshot taken per edit — an undo that rewinded one step would leave the
   * draft in a state the writer never wrote.
   */
  const commitComposer = useCallback(
    (next: { content: string; title: string; excerpt: string; tags: string[] }, origin: PilotComposerState, label: string) => {
      setTitle(next.title);
      setContent(next.content);
      setExcerpt(next.excerpt);
      setTags(next.tags);
      setPilotNotice({
        message: label,
        undo: () => {
          setTitle(origin.title);
          setContent(origin.content);
          setExcerpt(origin.excerpt);
          setTags(origin.tags);
          setPilotNotice(null);
          setPilotReview(null);
        },
      });
    },
    []
  );

  /**
   * Stage a pilot reply for review instead of applying it.
   *
   * This is the parse boundary: whatever the model returned is turned into a
   * list of *reviewable* edits, each diffed against the composer as it stands. A
   * reply with nothing to do is reported as such rather than silently leaving a
   * panel open on an empty list.
   */
  const stagePilot = useCallback(
    (
      action: PilotAction,
      reply: string,
      ops: PilotOp[],
      ranges: EditorRange,
      /** The composer the request was made against — decisive for the diff. */
      requested: { title: string; content: string; excerpt: string; tags: string[] }
    ) => {
      const base = { ...requested, tags: [...requested.tags] };
      const reviews = reviewPilotEdits(base, ops, ranges);
      if (reviews.length === 0) {
        setPilotNotice({ message: reply || "The pilot found nothing to change.", undo: null });
        return;
      }
      setPilotReview({ action, reply, ranges, base, origin: base, pending: ops, reviews });
      // The panel lives under the editor, which on a phone may be a screen away
      // from the Quick-edits button that opened it. Bringing it into view is the
      // difference between a proposal and a no-op.
      requestAnimationFrame(() => {
        reviewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    },
    []
  );

  /**
   * Ask the pilot for an edit, then stage every proposed change for review.
   *
   * The inline toolbar stages too, deliberately. It used to apply a selection
   * rewrite in place, which is fast and is also the one interaction where a
   * misread costs the writer a paragraph they have to reconstruct. Reviewing the
   * diff first is worth the extra tap; "Keep" is directly under the sentence it
   * changes.
   */
  const runPilot = useCallback(
    async (action: PilotAction, instruction?: string, opts: { range?: EditorRange } = {}) => {
      const ta = contentRef.current;
      const ranges: EditorRange =
        opts.range ??
        (ta
          ? {
              selectionStart: ta.selectionStart ?? 0,
              selectionEnd: ta.selectionEnd ?? 0,
              cursor: ta.selectionEnd ?? 0,
              hasSelection: (ta.selectionEnd ?? 0) > (ta.selectionStart ?? 0),
            }
          : selectionRange);
      const selection = ranges.hasSelection ? content.slice(ranges.selectionStart, ranges.selectionEnd) : "";
      // Snapshot the composer as the model will see it. Reviewing against a
      // later state would diff the proposal against a draft it was never written
      // for, which is how a diff starts lying.
      const requested = { title, content, excerpt, tags };

      setPilotBusy(action);
      setPilotNotice(null);
      setPilotReview(null);
      setError(null);
      try {
        const res = await fetch("/api/ai/studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action: "pilot",
            pilotAction: action,
            title,
            content,
            excerpt,
            category: categoryName,
            tags,
            selection: selection || undefined,
            prompt: instruction,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "The pilot could not answer.");
        const ops: PilotOp[] = Array.isArray(data.ops) ? data.ops : [];
        stagePilot(action, data.text ?? "", ops, ranges, requested);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The pilot could not answer.");
      } finally {
        setPilotBusy(null);
      }
    },
    [categoryName, content, excerpt, selectionRange, stagePilot, tags, title]
  );

  /**
   * Decide one proposed edit.
   *
   * Keeping an edit applies it immediately and re-diffs the remainder against
   * the draft it produced, so the panel always shows edits relative to the text
   * the writer is actually looking at. Discarding just drops it — the ops are
   * independent by construction (a `fix` locates its own phrase, field edits are
   * absolute), so neither choice can make a later one wrong.
   */
  const decidePilotEdit = useCallback(
    (op: PilotOp, keep: boolean) => {
      if (!pilotReview) return;
      const { action, pending: pendingAtStart } = pilotReview;
      const { base, ranges, origin, pending } = pilotReview;
      let nextBase = base;

      if (keep) {
        const applied = applyPilotOps(base, [op], ranges);
        if (applied.applied.length === 0) {
          // Nothing happened, so do not claim it did — and drop it from the list.
          const rest = pending.filter((candidate) => candidate !== op);
          setPilotReview(
            rest.length === 0
              ? null
              : { ...pilotReview, pending: rest, reviews: reviewPilotEdits(base, rest, ranges) }
          );
          setPilotNotice({ message: "Nothing needed changing there.", undo: null });
          return;
        }
        nextBase = { content: applied.content, title: applied.title, excerpt: applied.excerpt, tags: applied.tags };
        commitComposer(nextBase, origin, `Pilot ${applied.applied.join(", ")}.`);
        recordDecisions([
          {
            action,
            kind: "kept",
            field: PILOT_OP_FIELD[op.kind],
            opKind: op.kind,
            edits: pendingAtStart.length,
          },
        ]);
      } else {
        // A discarded proposal is as informative as a kept one: it is the half
        // of the signal that stops the pilot proposing the same thing again.
        recordDecisions([
          {
            action,
            kind: "discarded",
            field: PILOT_OP_FIELD[op.kind],
            opKind: op.kind,
            edits: pendingAtStart.length,
          },
        ]);
      }

      const rest = pending.filter((candidate) => candidate !== op);
      if (rest.length === 0) {
        setPilotReview(null);
        return;
      }
      setPilotReview({ ...pilotReview, base: nextBase, pending: rest, reviews: reviewPilotEdits(nextBase, rest, ranges) });
    },
    [commitComposer, pilotReview, recordDecisions]
  );

  /** Keep every remaining edit at once, in the order the model proposed them. */
  const keepAllPilotEdits = useCallback(() => {
    if (!pilotReview) return;
    const { base, ranges, origin, pending, action } = pilotReview;
    const applied = applyPilotOps(base, pending, ranges);
    if (applied.applied.length === 0) {
      setPilotReview(null);
      setPilotNotice({ message: "Nothing needed changing there.", undo: null });
      return;
    }
    commitComposer(
      { content: applied.content, title: applied.title, excerpt: applied.excerpt, tags: applied.tags },
      origin,
      `Pilot ${applied.applied.join(", ")}.`
    );
    recordDecisions(
      pending.map((op) => ({
        action,
        kind: "kept" as const,
        field: PILOT_OP_FIELD[op.kind],
        opKind: op.kind,
        edits: pending.length,
      }))
    );
    setPilotReview(null);
  }, [commitComposer, pilotReview, recordDecisions]);

  /** Drop the whole proposal without touching the draft. */
  const discardPilotEdits = useCallback(() => {
    setPilotReview(null);
    setPilotNotice({ message: "Proposed edits discarded — your draft is unchanged.", undo: null });
  }, []);

  /**
   * One bounded generation for the Article Forge.
   *
   * The forge runs here, in the composer, asking the studio endpoint for one
   * part at a time. That is what keeps a 1,200-word article from depending on a
   * single serverless request surviving end to end — the thing that used to cut
   * the piece off — and it is what lets the panel say which section is being
   * written instead of showing a spinner for a minute.
   */
  const askArticle = useCallback<ArticleAsk>(async ({ kind, prompt, maxTokens }) => {
    try {
      const res = await fetch("/api/ai/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "compose", promptKind: kind, prompt, maxTokens }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => ({}));
      return typeof data?.text === "string" && data.text.trim() ? data.text : null;
    } catch {
      // A failed part is reported by the forge as a missing section, which is
      // more useful than an exception in the middle of an article.
      return null;
    }
  }, []);

  /** Write a whole article from the composer's own context. */
  const writeArticle = useCallback(
    async (topic: string, targetWords: number) => {
      setArticle({ busy: true, progress: "Planning the article…", error: null, summary: null });
      forgedRef.current = null;
      try {
        const forged = await forgeArticle(
          { topic, category: categoryName, keywords: tags, targetWords },
          askArticle,
          {
            onProgress: (p) =>
              setArticle((prev) => ({
                ...prev,
                progress: p.phase === "writing" ? `Section ${p.sectionIndex + 1} of ${p.sections} — ${p.label}` : p.label,
              })),
          }
        );
        forgedRef.current = forged;
        setArticle({
          busy: false,
          progress: null,
          error: forged.words === 0 ? "Nothing came back from the writing model." : null,
          summary: {
            title: forged.plan.title,
            words: forged.words,
            sections: forged.plan.sections.length,
            repairs: forged.repairs,
            degraded: forged.degraded,
          },
        });
      } catch (err) {
        setArticle({
          busy: false,
          progress: null,
          error: err instanceof Error ? err.message : "The article could not be written.",
          summary: null,
        });
      }
    },
    [askArticle, categoryName, tags]
  );

  /**
   * Put the forged article in front of the writer — as a proposal, not a fait
   * accompli. Four ops, because an article is four things (the body, the
   * headline, the excerpt, the tags) and a writer may well want three of them.
   */
  const useForgedArticle = useCallback(() => {
    const forged = forgedRef.current;
    if (!forged) return;
    const ops: PilotOp[] = [
      { kind: "replace-draft", text: forged.markdown },
      { kind: "set-title", text: forged.plan.title },
      { kind: "set-excerpt", text: forged.excerpt },
      { kind: "add-tags", text: forged.tags.join(", ") },
    ];
    stagePilot(
      "article",
      `Drafted “${forged.plan.title}” — ${forged.words} words in ${forged.plan.sections.length} sections.`,
      ops,
      selectionRange,
      { title, content, excerpt, tags }
    );
    recordDecisions([{ action: "article", kind: "article", field: "content", opKind: "replace-draft", edits: ops.length }]);
    forgedRef.current = null;
    setArticle((prev) => ({ ...prev, summary: null }));
  }, [content, excerpt, recordDecisions, selectionRange, stagePilot, tags, title]);

  const discardForgedArticle = useCallback(() => {
    forgedRef.current = null;
    setArticle((prev) => ({ ...prev, summary: null }));
  }, []);

  const readSelection = useCallback((): string => { const ta = contentRef.current; if (ta && ta.selectionStart !== ta.selectionEnd) return ta.value.slice(ta.selectionStart, ta.selectionEnd).trim(); return ""; }, []);

  const runCopilot = useCallback(async (action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist" | "seo" | "plagiarism" | "optimize", usePrompt = false) => {
    const selection = readSelection(); const promptText = usePrompt ? copilotPrompt.trim() : "";
    if (action === "assist" && !promptText) { setCopilotError("Type a question first."); return; }
    setCopilotBusy(usePrompt ? action + ":prompt" : action); setCopilotError(null);
    try { const res = await fetch("/api/ai/studio", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action, title, content, excerpt, tags, category: categoryName, prompt: promptText || undefined, selection: selection || undefined }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || "The brain could not answer."); setCopilotResult({ action, text: data.text ?? "", alternatives: data.alternatives ?? [], meta: data.meta }); } catch (err) { setCopilotError(err instanceof Error ? err.message : "The brain could not answer."); } finally { setCopilotBusy(null); }
  }, [content, title, excerpt, tags, categoryName, copilotPrompt, readSelection]);

  const applyCopilot = useCallback((result: NonNullable<typeof copilotResult>) => {
    const ta = contentRef.current; const { action, text, meta } = result;
    const selected = ta && ta.selectionStart !== ta.selectionEnd; const start = ta?.selectionStart ?? 0; const end = ta?.selectionEnd ?? 0;
    if (action === "headline") { setTitle(text); setCopilotResult(null); return; }
    if (action === "summarize") { setExcerpt(text); setCopilotResult(null); return; }
    if (action === "tags") { const next = text.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean).slice(0, 10); setTags((prev) => [...new Set([...prev, ...next])].slice(0, 10)); setTagInput(""); setCopilotResult(null); return; }
    if (action === "rewrite") { if (selected && ta) { setContent(ta.value.slice(0, start) + text + ta.value.slice(end)); requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start, start + text.length); }); } else { setContent(text); } setCopilotResult(null); return; }
    if (action === "continue") { setContent((prev) => prev.trimEnd() + "\n\n" + (meta?.heading ? meta.heading + "\n\n" : "") + text); setCopilotResult(null); return; }
    /*
     * Reports stop here.
     *
     * An SEO audit, a plagiarism check, a curation brief or a chat answer has no
     * composer field — it is something to read. The old fallthrough pasted it at
     * the caret, which is how a writer asking "how is this ranking?" ended up
     * with a markdown report spliced into their article. Closing the panel is the
     * only correct outcome for these actions.
     */
    setCopilotResult(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback(() => { setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragOver(false); const file = e.dataTransfer.files[0]; if (file && file.type.startsWith("image/")) { const reader = new FileReader(); reader.onload = (ev) => setCoverImage(ev.target?.result as string); reader.readAsDataURL(file); setCoverFile(file); } }, []);
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => setCoverImage(ev.target?.result as string); reader.readAsDataURL(file); setCoverFile(file); } }, []);

  async function uploadCoverImage(): Promise<string | null> {
    if (!coverFile) return coverImage;
    const formData = new FormData(); formData.append("file", coverFile); formData.append("kind", "post");
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) { const err = await res.json().catch(() => ({ error: "Upload failed" })); throw new Error(err.error || "Failed to upload"); }
    return (await res.json()).url;
  }

  async function publishPost(postStatus: "published" | "draft") {
    setError(null); setReviewNotice(null);
    if (!title.trim()) { setError("Title is required"); return; }
    if (!content.trim()) { setError("Content is required"); return; }
    if (postStatus === "published") setIsPublishing(true);
    try {
      const scheduleDate = scheduledFor ? new Date(scheduledFor) : null;
      const isScheduled = postStatus === "published" && scheduleDate && !isNaN(scheduleDate.getTime()) && scheduleDate.getTime() > Date.now() + 60000;
      let finalExcerpt = excerpt; let finalTags = tags;
      if (postStatus === "published" && !isScheduled && content.trim().length >= 40) {
        const needsExcerpt = !finalExcerpt.trim(); const needsTags = finalTags.length === 0;
        if (needsExcerpt || needsTags) {
          const [sumRes, tagRes] = await Promise.all([
            needsExcerpt ? fetch("/api/ai/studio", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "summarize", content }) }) : Promise.resolve(null),
            needsTags ? fetch("/api/ai/studio", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ action: "tags", content }) }) : Promise.resolve(null),
          ]);
          let filled = false;
          if (sumRes?.ok) { const d = await sumRes.json(); if (d?.text) { finalExcerpt = d.text.slice(0, 300); setExcerpt(finalExcerpt); filled = true; } }
          if (tagRes?.ok) { const d = await tagRes.json(); if (d?.text) { finalTags = parseTagList(d.text); setTags(finalTags); filled = true; } }
          if (filled) { setReviewNotice("The brain auto-filled your missing excerpt/tags — review them, then click Publish again."); return; }
        }
      }
      let uploadedCoverUrl: string | null = null;
      if (coverFile) { uploadedCoverUrl = await uploadCoverImage(); } else if (coverImage) { uploadedCoverUrl = coverImage; }
      const matchedCategory = categoriesList.find((c) => c.id === categoryId || c.name === categoryName);
      const finalStatus = isScheduled ? "DRAFT" : postStatus === "published" ? "PUBLISHED" : "DRAFT";
      const payload = { title: title.trim(), content: content.trim(), excerpt: finalExcerpt.trim() || null, coverImage: uploadedCoverUrl, categoryId: matchedCategory?.id ?? null, tags: finalTags, status: finalStatus, scheduledAt: isScheduled ? scheduleDate!.toISOString() : null };
      const res = editingId ? await fetch("/api/posts/" + editingId, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) : await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (res.status === 401) { router.push("/auth/signin"); return; }
      if (!res.ok) { const err = await res.json().catch(() => ({ error: "Publish failed" })); if (err.code === "EMAIL_NOT_VERIFIED") { setError("Your email isn't verified."); router.push("/auth/verify-email?sent=0"); return; } throw new Error(err.error || "Failed to publish"); }
      const data = await res.json();
      if (editingId) setEditStatus(finalStatus);
      try { localStorage.removeItem(BACKUP_KEY); } catch {}
      if (isScheduled) { setError("Story scheduled."); loadMyStories(); return; }
      if (finalStatus === "PUBLISHED" && data?.moderationStatus === "PENDING") { setReviewNotice("Your story is under review."); loadMyStories(); return; }
      if (finalStatus === "PUBLISHED") { const slug = data?.post?.slug; if (slug) { router.push("/article/" + slug); return; } }
      loadMyStories();
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong"); } finally { setIsPublishing(false); }
  }

  async function deletePost(id: string) {
    if (!window.confirm("Delete this story permanently?")) return;
    try { const res = await fetch("/api/posts/" + id, { method: "DELETE" }); if (res.status === 401) { router.push("/auth/signin"); return; } if (!res.ok) { const err = await res.json().catch(() => ({ error: "Delete failed" })); throw new Error(err.error || "Failed to delete"); } setMyStories((prev) => prev.filter((p) => p.id !== id)); if (editingId === id) { setEditingId(null); setEditStatus(null); setScheduledFor(""); setTitle(""); setContent(""); setExcerpt(""); setTags([]); setCategoryId(null); setCategoryName(""); setCoverImage(null); setCoverFile(null); } } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong"); }
  }

  function openStory(id: string) {
    setEditingId(id); window.history.replaceState(null, "", "/studio?edit=" + id);
    fetch("/api/posts/" + id).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.post) return; setTitle(d.post.title ?? ""); setContent(d.post.content ?? ""); setExcerpt(d.post.excerpt ?? ""); setCoverImage(d.post.coverImage ?? null); setTags((d.post.tags ?? []).map((t: any) => t.slug));
      if (d.post.category) { setCategoryId(d.post.category.id); setCategoryName(d.post.category.name); }
      setEditStatus(d.post.status ?? null); setScheduledFor(dateToLocalInput(d.post.scheduledAt)); setLastSaved(null);
    }).catch(() => {});
  }

  function newStory() {
    setEditingId(null); setEditStatus(null); setScheduledFor(""); setTitle(""); setContent(""); setExcerpt(""); setTags([]); setCategoryId(null); setCategoryName(""); setCoverImage(null); setCoverFile(null); setLastSaved(null);
    window.history.replaceState(null, "", "/studio"); contentRef.current?.focus();
  }

  const scheduledValid = !!scheduledFor && new Date(scheduledFor).getTime() > now + 60000;

  return (
    <div className="relative min-h-screen bg-surface-950 overflow-x-clip">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-mesh-gradient opacity-60" />
      <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="pointer-events-none absolute top-40 -left-24 h-72 w-72 rounded-full bg-accent-coral/5 blur-3xl" />

      <div className="sticky top-0 z-40 border-b border-surface-800/50 bg-surface-950/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => (editingId ? newStory() : router.push("/"))} className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-50 transition-colors shrink-0"><ArrowLeft className="w-4 h-4" /><span className="hidden sm:inline">Back</span></button>
            <div className="h-5 w-px bg-surface-800 hidden sm:block" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-coral shadow-glow"><PenLine className="w-3.5 h-3.5 text-white" /></span>
              <div className="min-w-0">
                <span className="text-sm font-semibold text-surface-50 truncate block leading-tight">{editingId ? "Editing story" : "Story Studio"}</span>
                <span className="type-caption text-surface-500 hidden sm:block">{editingId ? "Drafting · autosave on" : "New story · autosave on"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 text-xs">
              {saving ? (<span className="text-surface-500 flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" /><span className="hidden sm:inline">Saving...</span></span>) : lastSaved ? (<span className="flex items-center gap-1 text-surface-500"><Clock className="w-3 h-3" /><span className="hidden sm:inline">Saved</span> {lastSaved}</span>) : null}
            </div>
            <span className="text-[10px] text-surface-600 hidden md:inline">{wordCount} words · {readTime}m</span>
            <button onClick={() => setShowPreview(!showPreview)} className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border", showPreview ? "bg-brand-500/10 border-brand-500/30 text-accent-strong" : "border-surface-700 text-surface-400 hover:text-surface-50")}>
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}<span className="hidden sm:inline">{showPreview ? "Edit" : "Preview"}</span>
            </button>
            <button onClick={() => publishPost("draft")} disabled={isPublishing || !title.trim()} className={cn("rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors border-surface-700 text-surface-400 hover:text-surface-50", (!title.trim() || isPublishing) && "opacity-50 cursor-not-allowed")}><span className="hidden sm:inline">Save Draft</span><span className="sm:hidden">Draft</span></button>
            <button onClick={() => publishPost("published")} disabled={isPublishing || !title.trim()} className={cn("rounded-lg px-3 sm:px-4 py-1.5 text-xs font-semibold transition-all", isPublishing || !title.trim() ? "bg-surface-800 text-surface-500 cursor-not-allowed" : "btn-gradient text-white shadow-glow hover:scale-[1.03]")}>
              {isPublishing ? (<span className="flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Publishing...</span>) : scheduledValid ? "Schedule" : editingId && editStatus === "PUBLISHED" ? "Update" : "Publish"}
            </button>
          </div>
        </div>
      </div>

      {error && (<div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4"><div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400"><AlertCircle className="w-4 h-4 shrink-0" /><span className="flex-1">{error}</span><button onClick={() => setError(null)} className="text-red-400 hover:text-red-300"><X className="w-4 h-4" /></button></div></div>)}

      {reviewNotice && (<div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4"><div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3 text-sm text-emerald-300"><span className="shrink-0">✨</span><span className="flex-1">{reviewNotice}</span><button onClick={() => setReviewNotice(null)} className="text-emerald-400 hover:text-emerald-300"><X className="w-4 h-4" /></button></div></div>)}

      {pilotNotice && (
        <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4">
          <div className="flex items-center gap-2 rounded-xl border border-accent-violet/30 bg-accent-violet/10 px-4 py-3 text-sm text-accent-violet">
            <Wand2 className="w-4 h-4 shrink-0" />
            <span className="flex-1">{pilotNotice.message}</span>
            {pilotNotice.undo ? (
              <button
                onClick={pilotNotice.undo}
                className="shrink-0 rounded-lg border border-accent-violet/30 px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-accent-violet/20"
              >
                Undo
              </button>
            ) : null}
            <button onClick={() => setPilotNotice(null)} className="shrink-0 text-accent-violet hover:opacity-80">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 lg:pt-8 pb-28 md:pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 lg:gap-6">
          <div className="space-y-4">
            {showPreview ? (
              <StudioPreview title={title} content={content} excerpt={excerpt} coverImage={coverImage} categoryName={categoryName} tags={tags} />
            ) : (
              <>
                <div onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop} className={cn("relative rounded-2xl border-2 border-dashed transition-all overflow-hidden", coverImage ? "border-brand-500/40 ring-1 ring-brand-500/20" : isDragOver ? "border-brand-500 bg-gradient-to-br from-brand-500/10 to-accent-coral/5" : "border-surface-700/60 bg-gradient-to-br from-surface-900/30 to-transparent hover:border-brand-500/30")}>
                  {coverImage ? (<div className="relative"><Image src={coverImage} alt="Cover" width={768} height={432} className="w-full h-36 sm:h-48 object-cover" unoptimized /><div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-3"><label className="cursor-pointer rounded-lg bg-black/70 backdrop-blur-sm px-4 py-2 text-xs font-medium text-white hover:bg-black/80 transition-colors border border-white/20">Change<input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" /></label><button onClick={() => { setCoverImage(null); setCoverFile(null); }} className="rounded-lg bg-red-500/80 backdrop-blur-sm px-4 py-2 text-xs font-medium text-surface-50 hover:bg-red-500 transition-colors">Remove</button></div></div>) : (<label className="cursor-pointer flex flex-col items-center justify-center py-10 sm:py-14 px-6"><input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" /><div className={cn("w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center mb-3 transition-all", isDragOver ? "bg-gradient-to-br from-brand-500 to-accent-coral text-white scale-110 shadow-glow" : "bg-gradient-to-br from-brand-500/15 to-accent-coral/10 text-accent-strong border border-brand-500/20")}><Upload className="w-5 h-5 sm:w-6 sm:h-6" /></div><p className="text-sm font-semibold text-surface-200 mb-1">{isDragOver ? "Drop your image here" : "Upload a cover image"}</p><p className="text-xs text-surface-500">Drag and drop, or click · JPG, PNG up to 5MB</p></label>)}
                </div>
                <input type="text" placeholder="Your story title..." value={title} onChange={(e) => setTitle(e.target.value)} className="w-full bg-transparent text-2xl sm:text-3xl lg:text-4xl font-display font-extrabold text-editor placeholder-editor focus:outline-none tracking-tight border-b-2 border-transparent pb-3 focus:border-brand-500/30 transition-colors" />
                <StudioToolbar onInsert={insertMarkdown} disabled={showPreview} />
                <CheckedEditor
                  textareaRef={contentRef}
                  value={content}
                  onChange={setContent}
                  suggestions={writingChecks?.suggestions ?? []}
                  onApply={applyWritingCheck}
                  onDismiss={dismissWritingCheck}
                  onSelectionChange={setSelectionRange}
                  placeholder="Start writing your story... Share your perspective on technology, culture, business, or life in East Africa. Drag an image in to place it inline."
                />
                <div ref={reviewRef}>
                  {pilotReview ? (
                    <PilotReview
                      action={pilotReview.action}
                      reply={pilotReview.reply}
                      reviews={pilotReview.reviews}
                      busy={pilotBusy !== null}
                      onAccept={(index) => {
                        const op = pilotReview.reviews.find((r) => r.index === index)?.op;
                        if (op) decidePilotEdit(op, true);
                      }}
                      onReject={(index) => {
                        const op = pilotReview.reviews.find((r) => r.index === index)?.op;
                        if (op) decidePilotEdit(op, false);
                      }}
                      onAcceptAll={keepAllPilotEdits}
                      onRejectAll={discardPilotEdits}
                      onDismiss={discardPilotEdits}
                    />
                  ) : null}
                </div>

                {/*
                  The copilot lives in the sidebar, not here.

                  A floating panel inside the composer put a second assistant on
                  the same screen as the text it was changing, with its own
                  loading state and its own result surface. The quick edits, the
                  Article Forge and the SEO audit are now one panel in the
                  sidebar; every edit still lands in this review panel below.
                */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-surface-300 flex items-center gap-1.5"><AlignLeft className="w-3 h-3 text-accent-strong" />Excerpt</label>
                  <textarea placeholder="A brief summary of your story (shown in feeds and search results)..." value={excerpt} onChange={(e) => setExcerpt(e.target.value)} rows={3} maxLength={300} className="w-full bg-surface-800/80 border border-surface-700/50 rounded-xl px-4 py-3 text-sm text-editor font-medium placeholder-editor placeholder:font-normal focus:outline-none focus:border-brand-500/40 focus:ring-1 focus:ring-brand-500/20 resize-none leading-relaxed transition-all" />
                  <p className="type-caption text-surface-500 text-right">{excerpt.length}/300</p>
                </div>
              </>
            )}
          </div>

          <StudioSidebar title={title} content={content} tags={tags} setTags={setTags} tagInput={tagInput} setTagInput={setTagInput} handleAddTag={handleAddTag} handleRemoveTag={handleRemoveTag} handleTagKeyDown={handleTagKeyDown} aiSuggestions={aiSuggestions} setAiSuggestions={setAiSuggestions} assistWithPost={assistWithPost} categoryId={categoryId} setCategoryId={setCategoryId} categoryName={categoryName} setCategoryName={setCategoryName} categoriesList={categoriesList} categoryOpen={categoryOpen} setCategoryOpen={setCategoryOpen} scheduledFor={scheduledFor} setScheduledFor={setScheduledFor} now={now} wordCount={wordCount} readTime={readTime} myStories={myStories} storiesLoading={storiesLoading} storiesUnauth={storiesUnauth} editingId={editingId} openStory={openStory} newStory={newStory} deletePost={deletePost} copilotBusy={copilotBusy} runCopilot={runCopilot} copilotPrompt={copilotPrompt} setCopilotPrompt={setCopilotPrompt} copilotError={copilotError} setCopilotError={setCopilotError} copilotResult={copilotResult} setCopilotResult={setCopilotResult} applyCopilot={applyCopilot} writingChecks={writingChecks} checksBusy={checksBusy} applyWritingCheck={applyWritingCheck} applyAllWritingChecks={applyAllWritingChecks} dismissWritingCheck={dismissWritingCheck} excerpt={excerpt} pilotBusy={pilotBusy} runPilot={(action, instruction) => void runPilot(action, instruction)} article={article} defaultTopic={(title.trim() || tags[0] || "").slice(0, 120)} onWriteArticle={writeArticle} onUseArticle={useForgedArticle} onDiscardArticle={discardForgedArticle} error={error} setError={setError} />
        </div>
      </div>
    </div>
  );
}
