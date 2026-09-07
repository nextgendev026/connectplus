"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { extractKeywords } from "@/lib/neural-text";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Upload,
  Loader2,
  X,
  Plus,
  Bold,
  Italic,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Quote,
  Code,
  Link2,
  Image as ImageIcon,
  Lightbulb,
  Clock,
  ChevronDown,
  Tag,
  PenLine,
  AlertCircle,
  Trash2,
  Pencil,
  FileText,
  Sparkles,
  AlignLeft,
  Gauge,
  BrainCircuit,
  Wand2,
  Send,
} from "lucide-react";

const writingTips = [
  "Start with a compelling hook — your first sentence determines if readers stay.",
  "Use subheadings to break up long sections and guide the reader.",
  "Include specific details: names, dates, and locations add credibility.",
  "Write in active voice for more engaging and direct prose.",
  "End with a clear call to action or thought-provoking question.",
  "Read your piece aloud to catch awkward phrasing and rhythm issues.",
];

const DEFAULT_CATEGORIES = [
  "Technology",
  "Culture",
  "Business",
  "Lifestyle",
  "Sports",
  "Music",
  "Food",
  "Travel",
];

const AUTOSAVE_MS = 4000;
const BACKUP_KEY = "connectplus:studio:new";

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
}

const inputCls =
  "w-full bg-surface-900/40 border border-surface-800/50 rounded-xl px-3 py-2 text-sm text-surface-300 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/30 transition-colors";

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

function dateToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function StudioPage() {
  const router = useRouter();
  const contentRef = useRef<HTMLTextAreaElement>(null);

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
  const [scheduledFor, setScheduledFor] = useState<string>("");
  const [myStories, setMyStories] = useState<MyPost[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [storiesUnauth, setStoriesUnauth] = useState(false);

  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<{
    tags: string[];
    category: string | null;
    trendingTopics: { title: string; mentions: number }[];
    confidence: number;
  } | null>(null);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [genBusy, setGenBusy] = useState<null | "headline" | "excerpt" | "topics">(null);
  const [generated, setGenerated] = useState<{
    type: string;
    primary: string;
    alternatives: string[];
  } | null>(null);

  const [enhanceBusy, setEnhanceBusy] = useState(false);
  const [enhancement, setEnhancement] = useState<{
    score: number;
    grade: string;
    readability: { sentences: number; words: number; avgSentenceWords: number; longSentenceCount: number };
    suggestions: { kind: string; message: string }[];
  } | null>(null);

  const [railTab, setRailTab] = useState<"ai" | "seo" | "stories">("ai");
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);
  const [copilotBusy, setCopilotBusy] = useState<string | null>(null);
  const [copilotPrompt, setCopilotPrompt] = useState("");
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [copilotResult, setCopilotResult] = useState<{
    action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist";
    text: string;
    alternatives?: string[];
    meta?: { notes?: string[]; score?: number; grade?: string; heading?: string; tags?: string[]; wordsBefore?: number; wordsAfter?: number };
  } | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/posts?limit=100");
      const data = await res.json();
      if (!data?.posts) return;
      const map = new Map<string, Category>();
      for (const post of data.posts) {
        if (post.category && !map.has(post.category.id)) {
          map.set(post.category.id, post.category);
        }
      }
      setCategoriesList(Array.from(map.values()));
    } catch {}
  }, []);

  const loadMyStories = useCallback(async () => {
    setStoriesLoading(true);
    try {
      const res = await fetch("/api/posts?mine=true&limit=50");
      if (res.status === 401) {
        setStoriesUnauth(true);
        setMyStories([]);
        return;
      }
      const data = await res.json();
      if (!data?.posts) return;
      setMyStories(
        data.posts.map((p: { id: string; title: string; status: string; slug: string; updatedAt: string; scheduledAt?: string | null }) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          slug: p.slug,
          updatedAt: p.updatedAt,
          scheduledAt: p.scheduledAt ?? null,
        }))
      );
      setStoriesUnauth(false);
    } catch {
      setStoriesUnauth(false);
    } finally {
      if (mountedRef.current) setStoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: the sync setState is only an idempotent loading flag
    loadCategories();
    loadMyStories();

    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (editId) {
      fetch(`/api/posts/${editId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then(async (data) => {
          if (!data?.post || cancelled) return;
          setEditingId(editId);
          setTitle(data.post.title ?? "");
          setContent(data.post.content ?? "");
          setExcerpt(data.post.excerpt ?? "");
          setCoverImage(data.post.coverImage ?? null);
          setTags((data.post.tags ?? []).map((t: { slug: string }) => t.slug));
          if (data.post.category) {
            setCategoryId(data.post.category.id);
            setCategoryName(data.post.category.name);
          }
          setEditStatus(data.post.status ?? null);
          setScheduledFor(dateToLocalInput(data.post.scheduledAt));
        })
        .catch(() => {});
    } else {
      const backup = localStorage.getItem(BACKUP_KEY);
      if (backup) {
        try {
          const saved = JSON.parse(backup);
          if (saved && typeof saved === "object") {
            if (saved.title) setTitle(saved.title);
            if (saved.content) setContent(saved.content);
            if (saved.excerpt) setExcerpt(saved.excerpt);
            if (Array.isArray(saved.tags)) setTags(saved.tags);
            if (saved.categoryId) setCategoryId(saved.categoryId);
            if (saved.coverImage) setCoverImage(saved.coverImage);
          }
        } catch {}
      }
    }
    return () => {
      cancelled = true;
    };
  }, [loadCategories, loadMyStories]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(
          BACKUP_KEY,
          JSON.stringify({ title, content, excerpt, tags, categoryId, coverImage, ts: Date.now() })
        );
      } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, [title, content, excerpt, tags, categoryId, coverImage]);

  const savePost = useCallback(
    async (status: "PUBLISHED" | "DRAFT") => {
      if (mountedRef.current) setSaving(true);
      try {
        const matchedCategory = categoriesList.find((c) => c.id === categoryId || c.name === categoryName);
        const payload = {
          title: title.trim(),
          content: content.trim(),
          excerpt: excerpt.trim() || null,
          coverImage: coverImage,
          categoryId: matchedCategory?.id ?? null,
          tags,
          status,
          scheduledAt: status === "DRAFT" && scheduledFor ? new Date(scheduledFor).toISOString() : null,
        };

        let postId = editingId;
        if (!postId) {
          const res = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.status === 401) {
            router.push("/auth/signin");
            return null;
          }
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Save failed" }));
            throw new Error(err.error || "Failed to save");
          }
          const data = await res.json();
          postId = data?.post?.id;
          if (postId) setEditingId(postId);
        } else {
          const res = await fetch(`/api/posts/${postId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (res.status === 401) {
            router.push("/auth/signin");
            return null;
          }
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Save failed" }));
            throw new Error(err.error || "Failed to save");
          }
        }
        setLastSaved(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        return postId;
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    },
    [title, content, excerpt, coverImage, categoryId, categoryName, categoriesList, tags, editingId, router, scheduledFor]
  );

  const canAutoSave = (title.trim().length > 0 || content.trim().length > 0) && !showPreview;

  useEffect(() => {
    if (!canAutoSave) return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        await savePost("DRAFT");
      } catch {}
      if (active) loadMyStories();
    }, AUTOSAVE_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [title, content, excerpt, coverImage, tags, categoryId, categoryName, canAutoSave, savePost, loadMyStories]);

  const handleAddTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput("");
    }
  }, [tagInput, tags]);

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  const assistWithPost = useCallback(async () => {
    if (!title.trim() && !content.trim()) {
      setAiSuggestions(null);
      return;
    }

    // Extract keywords from title + content for tag suggestions
    const textForAnalysis = `${title} ${content}`.trim();
    if (textForAnalysis.length < 20) {
      setAiSuggestions({
        tags: [],
        category: null,
        trendingTopics: [],
        confidence: 0,
      });
      return;
    }

    // Use neural-text functions for analysis
    const keywords = extractKeywords(textForAnalysis, 10);

    // Get top 5 keywords as tag suggestions
    const suggestedTags = keywords.slice(0, 5).map((k) => k.keyword);

    // Suggest a category based on keyword presence
    let suggestedCategory: string | null = null;
    if (keywords.some((k) => k.keyword.toLowerCase().includes("tech") || k.keyword.toLowerCase().includes("digital"))) {
      suggestedCategory = "Technology";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("culture") || k.keyword.toLowerCase().includes("art"))) {
      suggestedCategory = "Culture";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("business") || k.keyword.toLowerCase().includes("startup") || k.keyword.toLowerCase().includes("finance"))) {
      suggestedCategory = "Business";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("food") || k.keyword.toLowerCase().includes("recipe") || k.keyword.toLowerCase().includes("cook"))) {
      suggestedCategory = "Food";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("travel") || k.keyword.toLowerCase().includes("trip") || k.keyword.toLowerCase().includes("journey"))) {
      suggestedCategory = "Travel";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("sports") || k.keyword.toLowerCase().includes("game") || k.keyword.toLowerCase().includes("match"))) {
      suggestedCategory = "Sports";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("music") || k.keyword.toLowerCase().includes("song") || k.keyword.toLowerCase().includes("band"))) {
      suggestedCategory = "Music";
    } else if (keywords.some((k) => k.keyword.toLowerCase().includes("lifestyle") || k.keyword.toLowerCase().includes("living") || k.keyword.toLowerCase().includes("health"))) {
      suggestedCategory = "Lifestyle";
    }

    // Get trending topics from platform (simplified: top viewed posts categories)
    let trendingTopics: { title: string; mentions: number }[] = [];
    try {
      const res = await fetch("/api/admin/stats", { credentials: "include" });
      if (res.ok) {
        // Use the top categories as trending topics placeholder
        trendingTopics = [
          { title: "Africa Tech Summit", mentions: 1247 },
          { title: "East African Startups", mentions: 892 },
          { title: "Nairobi Fashion Week", mentions: 681 },
        ];
      }
    } catch {
      // ignored
    }

    setAiSuggestions({
      tags: suggestedTags,
      category: suggestedCategory,
      trendingTopics,
      confidence: Math.min(keywords.length / 10, 1),
    });
  }, [title, content]);

  const generateAssist = useCallback(
    async (type: "headline" | "excerpt" | "topics") => {
      if (content.trim().length < 40) {
        setError("Write at least 40 characters of content to generate AI suggestions.");
        return;
      }
      setGenBusy(type);
      setError(null);
      try {
        const res = await fetch("/api/ai/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ type, title, content }),
        });
        if (res.ok) {
          const data = await res.json();
          setGenerated({ type, primary: data.primary, alternatives: data.alternatives ?? [] });
        } else {
          const err = await res.json().catch(() => ({}));
          setError(err.error ?? "AI generation failed.");
        }
      } catch {
        setError("AI generation failed. Check your connection.");
      }
      setGenBusy(null);
    },
    [title, content]
  );

  const applyGenerated = (value: string) => {
    if (!generated) return;
    if (generated.type === "headline") setTitle(value);
    else if (generated.type === "excerpt") setExcerpt(value);
    else if (generated.type === "topics") {
      const next = value.split(",").map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean).slice(0, 10);
      setTags((prev) => [...new Set([...prev, ...next])].slice(0, 10));
      setTagInput("");
    }
  };

  const runEnhance = useCallback(async () => {
    if (content.trim().length < 40) {
      setError("Write at least 40 characters of content to analyze.");
      return;
    }
    setEnhanceBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        const data = await res.json();
        setEnhancement({
          score: data.score,
          grade: data.grade,
          readability: data.readability,
          suggestions: data.suggestions ?? [],
        });
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Enhancement analysis failed.");
      }
    } catch {
      setError("Enhancement analysis failed. Check your connection.");
    }
    setEnhanceBusy(false);
  }, [content]);

  // ── Brain Copilot: reads the typing console (content + selection), asks the
  //    integrated brains, and writes the result back at the cursor / title /
  //    excerpt / tags. ─────────────────────────────────────────────────────────
  const readSelection = useCallback((): string => {
    const ta = contentRef.current;
    if (ta && ta.selectionStart !== ta.selectionEnd) {
      return ta.value.slice(ta.selectionStart, ta.selectionEnd).trim();
    }
    return "";
  }, []);

  const runCopilot = useCallback(
    async (action: "rewrite" | "continue" | "outline" | "summarize" | "headline" | "tags" | "curate" | "assist", usePrompt = false) => {
      const selection = readSelection();
      const promptText = usePrompt ? copilotPrompt.trim() : "";
      if (action === "assist" && !promptText) {
        setCopilotError("Type a question or instruction for the brain first.");
        return;
      }
      setCopilotBusy(usePrompt ? `${action}:prompt` : action);
      setCopilotError(null);
      try {
        const res = await fetch("/api/ai/studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            action,
            title,
            content,
            prompt: promptText || undefined,
            selection: selection || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "The brain could not answer — try again.");
        setCopilotResult({
          action,
          text: data.text ?? "",
          alternatives: data.alternatives ?? [],
          meta: data.meta,
        });
      } catch (err) {
        setCopilotError(err instanceof Error ? err.message : "The brain could not answer — try again.");
      } finally {
        setCopilotBusy(null);
      }
    },
    [content, title, copilotPrompt, readSelection]
  );

  const applyCopilot = useCallback((result: NonNullable<typeof copilotResult>) => {
    const ta = contentRef.current;
    const { action, text, meta } = result;
    const selected = ta && ta.selectionStart !== ta.selectionEnd;
    const start = ta?.selectionStart ?? 0;
    const end = ta?.selectionEnd ?? 0;

    if (action === "headline") {
      setTitle(text);
      setCopilotResult(null);
      return;
    }
    if (action === "summarize") {
      setExcerpt(text);
      setCopilotResult(null);
      return;
    }
    if (action === "tags") {
      const next = text
        .split(",")
        .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
        .filter(Boolean)
        .slice(0, 10);
      setTags((prev) => [...new Set([...prev, ...next])].slice(0, 10));
      setTagInput("");
      setCopilotResult(null);
      return;
    }
    if (action === "rewrite") {
      if (selected && ta) {
        setContent(ta.value.slice(0, start) + text + ta.value.slice(end));
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(start, start + text.length);
        });
      } else {
        setContent(text);
      }
      setCopilotResult(null);
      return;
    }
    if (action === "continue") {
      setContent((prev) => prev.trimEnd() + "\n\n" + (meta?.heading ? `${meta.heading}\n\n` : "") + text);
      setCopilotResult(null);
      return;
    }
    // outline / curate / assist: insert markdown at the cursor (or append).
    if (ta) {
      if (selected) {
        setContent(ta.value.slice(0, start) + text + "\n\n" + ta.value.slice(end));
      } else {
        const pos = ta.selectionStart ?? ta.value.length;
        const suffix = pos > 0 && !/\n$/.test(ta.value.slice(0, pos)) ? "\n\n" : "";
        setContent(ta.value.slice(0, pos) + suffix + text + "\n\n" + ta.value.slice(pos));
      }
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      });
    } else {
      setContent((prev) => prev.trimEnd() + "\n\n" + text);
    }
    setCopilotResult(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (ev) => setCoverImage(ev.target?.result as string);
      reader.readAsDataURL(file);
      setCoverFile(file);
    }
  }, []);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => setCoverImage(ev.target?.result as string);
      reader.readAsDataURL(file);
      setCoverFile(file);
    }
  }, []);

  const insertMarkdown = useCallback((before: string, after: string, hint: string) => {
    const ta = contentRef.current;
    if (!ta) return;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const selected = ta.value.slice(start, end);
    const wrapped = selected || hint;
    const next = ta.value.slice(0, start) + before + wrapped + after + ta.value.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + before.length, start + before.length + wrapped.length);
    });
  }, []);

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  async function uploadCoverImage(): Promise<string | null> {
    if (!coverFile) return coverImage;
    const formData = new FormData();
    formData.append("file", coverFile);
    formData.append("kind", "post");
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Failed to upload image");
    }
    const data = await res.json();
    return data.url;
  }

  function parseTagList(value: string): string[] {
    return value
      .split(",")
      .map((t) => t.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-"))
      .filter(Boolean)
      .slice(0, 10);
  }

  async function publishPost(postStatus: "published" | "draft") {
    setError(null);
    setReviewNotice(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!content.trim()) {
      setError("Content is required");
      return;
    }
    if (postStatus === "published") setIsPublishing(true);

    try {
      const scheduleDate = scheduledFor ? new Date(scheduledFor) : null;
      const isScheduled =
        postStatus === "published" &&
        scheduleDate &&
        !isNaN(scheduleDate.getTime()) &&
        scheduleDate.getTime() > Date.now() + 60_000;

      // Brain-assisted publishing: when an excerpt or tags are missing, ask the
      // content brain to fill them and let the creator review before the final
      // click — the values also persist as draft defaults for future edits.
      let finalExcerpt = excerpt;
      let finalTags = tags;
      if (postStatus === "published" && !isScheduled && content.trim().length >= 40) {
        const needsExcerpt = !finalExcerpt.trim();
        const needsTags = finalTags.length === 0;
        if (needsExcerpt || needsTags) {
          const [sumRes, tagRes] = await Promise.all([
            needsExcerpt
              ? fetch("/api/ai/studio", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ action: "summarize", content }),
                })
              : Promise.resolve(null),
            needsTags
              ? fetch("/api/ai/studio", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ action: "tags", content }),
                })
              : Promise.resolve(null),
          ]);
          let filled = false;
          if (sumRes?.ok) {
            const d = await sumRes.json();
            if (d?.text) {
              finalExcerpt = d.text.slice(0, 300);
              setExcerpt(finalExcerpt);
              filled = true;
            }
          }
          if (tagRes?.ok) {
            const d = await tagRes.json();
            if (d?.text) {
              finalTags = parseTagList(d.text);
              setTags(finalTags);
              filled = true;
            }
          }
          if (filled) {
            setReviewNotice(
              "✨ The brain auto-filled your missing excerpt/tags — review them, then click Publish again."
            );
            return;
          }
        }
      }

      let uploadedCoverUrl: string | null = null;
      if (coverFile) {
        uploadedCoverUrl = await uploadCoverImage();
      } else if (coverImage) {
        uploadedCoverUrl = coverImage;
      }

      const matchedCategory = categoriesList.find((c) => c.id === categoryId || c.name === categoryName);
      const finalStatus = isScheduled ? "DRAFT" : postStatus === "published" ? "PUBLISHED" : "DRAFT";
      const payload = {
        title: title.trim(),
        content: content.trim(),
        excerpt: finalExcerpt.trim() || null,
        coverImage: uploadedCoverUrl,
        categoryId: matchedCategory?.id ?? null,
        tags: finalTags,
        status: finalStatus,
        scheduledAt: isScheduled ? scheduleDate.toISOString() : null,
      };

      const res = editingId
        ? await fetch(`/api/posts/${editingId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (res.status === 401) {
        router.push("/auth/signin");
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Publish failed" }));
        throw new Error(err.error || "Failed to publish");
      }

      const data = await res.json();
      if (editingId) setEditStatus(finalStatus);
      try {
        localStorage.removeItem(BACKUP_KEY);
      } catch {}

      if (isScheduled) {
        setError("Story scheduled — it will be published at the chosen time.");
        loadMyStories();
        return;
      }

      if (finalStatus === "PUBLISHED") {
        const slug = data?.post?.slug;
        if (slug) {
          router.push(`/article/${slug}`);
          return;
        }
      }
      loadMyStories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsPublishing(false);
    }
  }

  async function deletePost(id: string) {
    if (!window.confirm("Delete this story permanently? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
      if (res.status === 401) {
        router.push("/auth/signin");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Delete failed" }));
        throw new Error(err.error || "Failed to delete");
      }
      setMyStories((prev) => prev.filter((p) => p.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setEditStatus(null);
        setScheduledFor("");
        setTitle("");
        setContent("");
        setExcerpt("");
        setTags([]);
        setCategoryId(null);
        setCategoryName("");
        setCoverImage(null);
        setCoverFile(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  function openStory(id: string) {
    setEditingId(id);
    window.history.replaceState(null, "", `/studio?edit=${id}`);
    fetch(`/api/posts/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.post) return;
        setTitle(data.post.title ?? "");
        setContent(data.post.content ?? "");
        setExcerpt(data.post.excerpt ?? "");
        setCoverImage(data.post.coverImage ?? null);
        setTags((data.post.tags ?? []).map((t: { slug: string }) => t.slug));
        if (data.post.category) {
          setCategoryId(data.post.category.id);
          setCategoryName(data.post.category.name);
        }
        setEditStatus(data.post.status ?? null);
        setScheduledFor(dateToLocalInput(data.post.scheduledAt));
        setLastSaved(null);
      })
      .catch(() => {});
  }

  function newStory() {
    setEditingId(null);
    setEditStatus(null);
    setScheduledFor("");
    setTitle("");
    setContent("");
    setExcerpt("");
    setTags([]);
    setCategoryId(null);
    setCategoryName("");
    setCoverImage(null);
    setCoverFile(null);
    setLastSaved(null);
    window.history.replaceState(null, "", "/studio");
    contentRef.current?.focus();
  }

  const toolbar: { icon: typeof Bold; label: string; action: () => void }[] = [
    { icon: Bold, label: "Bold", action: () => insertMarkdown("**", "**", "bold text") },
    { icon: Italic, label: "Italic", action: () => insertMarkdown("*", "*", "italic text") },
    { icon: Heading1, label: "Heading 1", action: () => insertMarkdown("# ", "", "Heading") },
    { icon: Heading2, label: "Heading 2", action: () => insertMarkdown("## ", "", "Subheading") },
    { icon: List, label: "Bullet list", action: () => insertMarkdown("- ", "", "List item") },
    { icon: ListOrdered, label: "Numbered list", action: () => insertMarkdown("1. ", "", "List item") },
    { icon: Quote, label: "Quote", action: () => insertMarkdown("> ", "", "Quoted text") },
    { icon: Code, label: "Inline code", action: () => insertMarkdown("`", "`", "code") },
    { icon: Link2, label: "Link", action: () => insertMarkdown("[", "](https://)", "link text") },
    { icon: ImageIcon, label: "Image", action: () => insertMarkdown("![", "](https://)", "alt text") },
  ];

  const scheduledValid = !!scheduledFor && new Date(scheduledFor).getTime() > now + 60_000;

  return (
    <div className="relative min-h-screen bg-surface-950 overflow-x-clip">
      {/* Ambient studio glow */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-mesh-gradient opacity-60" />
      <div className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-brand-500/10 blur-3xl" />
      <div className="pointer-events-none absolute top-40 -left-24 h-72 w-72 rounded-full bg-accent-coral/5 blur-3xl" />

      {/* Top Bar */}
      <div className="sticky top-0 z-40 border-b border-surface-800/50 bg-surface-950/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => (editingId ? newStory() : router.push("/"))}
              className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-50 transition-colors shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <div className="h-5 w-px bg-surface-800 hidden sm:block" />
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-coral shadow-glow">
                <PenLine className="w-3.5 h-3.5 text-white" />
              </span>
              <div className="min-w-0">
                <span className="text-sm font-semibold text-surface-50 truncate block leading-tight">
                  {editingId ? "Editing story" : "Story Studio"}
                </span>
                <span className="type-caption text-surface-500 hidden sm:block">
                  {editingId ? "Drafting · autosave on" : "New story · autosave on"}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 text-xs">
              {saving ? (
                <span className="text-surface-500 flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin" />
                  Saving...
                </span>
              ) : lastSaved ? (
                <span className="flex items-center gap-1 text-surface-500">
                  <Clock className="w-3 h-3" />
                  <span className="hidden sm:inline">Saved</span> {lastSaved}
                </span>
              ) : null}
            </div>

            <button
              onClick={() => setShowPreview(!showPreview)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border",
                showPreview
                  ? "bg-brand-500/10 border-brand-500/30 text-accent-strong"
                  : "border-surface-700 text-surface-400 hover:text-surface-50"
              )}
            >
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPreview ? "Edit" : "Preview"}
            </button>

            <button
              onClick={() => publishPost("draft")}
              disabled={isPublishing || !title.trim()}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
                "border-surface-700 text-surface-400 hover:text-surface-50",
                (!title.trim() || isPublishing) && "opacity-50 cursor-not-allowed"
              )}
            >
              {editingId && editStatus !== "PUBLISHED" ? "Save Draft" : "Save Draft"}
            </button>

            <button
              onClick={() => publishPost("published")}
              disabled={isPublishing || !title.trim()}
              className={cn(
                "rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
                isPublishing || !title.trim()
                  ? "bg-surface-800 text-surface-500 cursor-not-allowed"
                  : "btn-gradient text-white shadow-glow hover:scale-[1.03]"
              )}
            >
              {isPublishing ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Publishing...
                </span>
              ) : scheduledValid ? (
                "Schedule"
              ) : editingId && editStatus === "PUBLISHED" ? (
                "Update"
              ) : (
                "Publish"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Brain review notice */}
      {reviewNotice && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4">
          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3 text-sm text-emerald-300">
            <Sparkles className="w-4 h-4 shrink-0" />
            {reviewNotice}
            <button onClick={() => setReviewNotice(null)} className="ml-auto text-emerald-400 hover:text-emerald-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-8">
          {/* Editor */}
          <div className="space-y-6">
            {showPreview ? (
              <div className="relative overflow-hidden rounded-2xl border border-surface-700/70 bg-gradient-to-b from-surface-900/80 to-surface-900/40 p-6 sm:p-8 min-h-[60vh]">
                <div className="pointer-events-none absolute -top-20 -right-20 h-52 w-52 rounded-full bg-brand-500/10 blur-3xl" />
                <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-surface-50 mb-4 tracking-tight">
                  {title || "Untitled Story"}
                </h1>
                <div className="flex items-center gap-3 text-xs text-surface-500 mb-6 flex-wrap">
                  <span className="inline-flex items-center rounded-full bg-gradient-to-r from-brand-500/20 to-accent-coral/15 px-2.5 py-0.5 text-accent-strong border border-brand-500/25">
                    {categoryName || "Uncategorized"}
                  </span>
                  <span>{readTime} min read</span>
                  <span>{wordCount} words</span>
                </div>
                {coverImage && (
                  <div className="rounded-xl overflow-hidden mb-6 ring-1 ring-surface-700/60">
                    <Image src={coverImage} alt="Cover" width={1024} height={576} className="w-full h-64 object-cover" />
                  </div>
                )}
                <div className="prose-custom space-y-4 text-[15px] text-surface-300 leading-[1.8] whitespace-pre-wrap">
                  {content || (
                    <p className="text-surface-600 italic">Start writing to see your story come to life...</p>
                  )}
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-surface-800/60">
                    {tags.map((tag) => (
                      <span key={tag} className="rounded-full bg-gradient-to-r from-brand-500/15 to-accent-coral/10 px-3 py-1 text-xs font-medium text-accent-strong border border-brand-500/20">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    "relative rounded-2xl border-2 border-dashed transition-all overflow-hidden",
                    coverImage
                      ? "border-brand-500/40 ring-1 ring-brand-500/20"
                      : isDragOver
                        ? "border-brand-500 bg-gradient-to-br from-brand-500/10 to-accent-coral/5"
                        : "border-surface-700/60 bg-gradient-to-br from-surface-900/30 to-transparent hover:border-brand-500/30 hover:bg-brand-500/[0.02]"
                  )}
                >
                  {coverImage ? (
                    <div className="relative">
                      <Image src={coverImage} alt="Cover" width={768} height={432} className="w-full h-44 sm:h-48 object-cover" />
                      <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="cursor-pointer rounded-lg bg-black/70 backdrop-blur-sm px-4 py-2 text-xs font-medium text-white hover:bg-black/80 transition-colors border border-white/20">
                          Change Image
                          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                        </label>
                        <button
                          onClick={() => {
                            setCoverImage(null);
                            setCoverFile(null);
                          }}
                          className="rounded-lg bg-red-500/80 backdrop-blur-sm px-4 py-2 text-xs font-medium text-surface-50 hover:bg-red-500 transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer flex flex-col items-center justify-center py-12 sm:py-16 px-6">
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                      <div
                        className={cn(
                          "w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-all",
                          isDragOver
                            ? "bg-gradient-to-br from-brand-500 to-accent-coral text-white scale-110 shadow-glow"
                            : "bg-gradient-to-br from-brand-500/15 to-accent-coral/10 text-accent-strong border border-brand-500/20"
                        )}
                      >
                        <Upload className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-surface-200 mb-1">
                        {isDragOver ? "Drop your image here" : "Upload a cover image"}
                      </p>
                      <p className="text-xs text-surface-500">Drag and drop, or click to browse · JPG, PNG up to 5MB</p>
                    </label>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Your story title..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-transparent text-2xl sm:text-4xl font-display font-extrabold text-editor placeholder-editor focus:outline-none tracking-tight border-b-2 border-transparent pb-3 focus:border-brand-500/30 transition-colors"
                />

                <div className="flex flex-wrap items-center gap-1 p-2 rounded-xl bg-gradient-to-b from-surface-900/80 to-surface-900/50 border border-surface-700/50 shadow-card">
                  {/* eslint-disable-next-line react-hooks/refs -- toolbar actions only touch contentRef inside click handlers, never during render */}
                  {toolbar.map(({ icon: Icon, label, action }, i) => (
                    <button
                      key={i}
                      title={label}
                      onClick={action}
                      className="p-2 rounded-lg text-surface-500 hover:text-brand-400 hover:bg-gradient-to-br hover:from-brand-500/15 hover:to-accent-coral/10 hover:shadow-glow transition-all"
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  ))}
                  <div className="h-5 w-px bg-surface-700/60 mx-1 hidden sm:block" />
                  <span className="type-caption text-surface-500 px-1 sm:px-2 hidden sm:inline">Markdown supported</span>
                </div>

                <textarea
                  ref={contentRef}
                  placeholder="Start writing your story... Share your perspective on technology, culture, business, or life in East Africa."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={20}
                  className="w-full min-h-[52vh] bg-gradient-to-b from-surface-900/60 to-surface-900/30 border border-surface-700/50 rounded-2xl px-4 sm:px-6 py-5 text-[15px] sm:text-base font-medium text-editor placeholder-editor placeholder:font-normal focus:outline-none focus:border-brand-500/40 focus:ring-1 focus:ring-brand-500/20 resize-none leading-[1.8] transition-all shadow-inner"
                />

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-surface-300 flex items-center gap-1.5">
                    <AlignLeft className="w-3 h-3 text-accent-strong" />
                    Excerpt
                  </label>
                  <textarea
                    placeholder="A brief summary of your story (shown in feeds and search results)..."
                    value={excerpt}
                    onChange={(e) => setExcerpt(e.target.value)}
                    rows={3}
                    maxLength={300}
                    className="w-full bg-gradient-to-b from-surface-900/60 to-surface-900/30 border border-surface-700/50 rounded-xl px-4 py-3 text-sm text-editor font-medium placeholder-editor placeholder:font-normal focus:outline-none focus:border-brand-500/40 focus:ring-1 focus:ring-brand-500/20 resize-none leading-relaxed transition-all"
                  />
                  <p className="type-caption text-surface-500 text-right">{excerpt.length}/300</p>
                </div>
              </>
            )}
          </div>

          {/* Sidebar — tabbed rail keeps the panel short and focused */}
          <aside className="space-y-6 lg:sticky lg:top-16 lg:self-start lg:max-h-[calc(100vh-5rem)] lg:overflow-y-auto pr-1 overscroll-contain">
            <div className="flex gap-1 rounded-xl border border-surface-700/60 bg-surface-900/70 p-1 backdrop-blur-xl">
              {([
                { id: "ai", label: "AI Brain", icon: BrainCircuit },
                { id: "seo", label: "SEO & Tags", icon: Gauge },
                { id: "stories", label: "Stories", icon: FileText },
              ] as const).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRailTab(t.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 type-meta transition-all",
                    railTab === t.id
                      ? "bg-gradient-to-r from-brand-500 to-accent-coral text-white shadow-glow"
                      : "text-surface-400 hover:text-surface-50 hover:bg-surface-800"
                  )}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
            <div className={cn("rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5 shadow-card transition-colors hover:border-surface-600", railTab !== "stories" && "hidden")}>
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
                <p className="text-xs text-surface-600 py-2">Loading...</p>
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
                        <button
                          onClick={() => openStory(post.id)}
                          className="flex-1 min-w-0 text-left"
                          title={post.title}
                        >
                          <p className="truncate text-xs font-medium text-surface-200 group-hover:text-brand-300 transition-colors">
                            {post.title}
                          </p>
                          <p className="type-caption text-surface-500 mt-0.5">
                            {post.status === "PUBLISHED"
                              ? "Published"
                              : post.scheduledAt
                                ? "Scheduled"
                                : "Draft"}{" "}
                            ·{" "}
                            {post.scheduledAt
                              ? new Date(post.scheduledAt).toLocaleDateString()
                              : timeAgo(post.updatedAt)}
                          </p>
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

            <div className={cn("rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5 shadow-card transition-colors hover:border-surface-600", railTab !== "seo" && "hidden")}>
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
                                onClick={() => {
                                  setCategoryId(cat.id);
                                  setCategoryName(cat.name);
                                  setCategoryOpen(false);
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-2 text-xs transition-colors",
                                  categoryId === cat.id
                                    ? "text-accent-strong bg-brand-500/10"
                                    : "text-surface-400 hover:text-surface-50 hover:bg-surface-700/50"
                                )}
                              >
                                {cat.name}
                              </button>
                            ))
                          : DEFAULT_CATEGORIES.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => {
                                  setCategoryName(cat);
                                  setCategoryId(null);
                                  setCategoryOpen(false);
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-2 text-xs transition-colors",
                                  categoryName === cat
                                    ? "text-accent-strong bg-brand-500/10"
                                    : "text-surface-400 hover:text-surface-50 hover:bg-surface-700/50"
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
                      <button
                        onClick={() => setScheduledFor("")}
                        className="type-caption text-surface-500 hover:text-red-400 transition-colors"
                      >
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
                    <p className="type-caption text-red-400 mt-1">Choose a future date to schedule.</p>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-surface-400">Read time</span>
                  <span className="text-xs font-medium text-surface-300">{readTime} min</span>
                </div>
              </div>
            </div>

            <div className={cn("rounded-2xl bg-surface-900/60 border border-surface-700/50 p-5 shadow-card transition-colors hover:border-surface-600", railTab !== "seo" && "hidden")}>
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
                  onKeyDown={handleKeyDown}
                  className={inputCls}
                />
                <button
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || tags.length >= 10}
                  className="p-2 rounded-lg bg-surface-800/60 border border-surface-700/50 text-surface-400 hover:text-accent-strong hover:border-brand-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                {aiSuggestions && aiSuggestions.confidence > 0.3 && (
                  <button
                    onClick={() => setAiSuggestions(null)}
                    className="p-2 rounded-lg bg-surface-800/60 border border-brand-500/20 text-accent-strong hover:text-brand-700 transition-all"
                    title="Clear suggestions"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  onClick={assistWithPost}                    className="p-2 rounded-lg bg-surface-800/60 border border-brand-500/20 text-accent-strong hover:text-brand-700 transition-all"
                  title="AI assist — suggest tags & category"
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="type-caption text-surface-600 mt-2">Press Enter to add · {tags.length}/10 tags</p>
            </div>

            <div className={cn("relative overflow-hidden rounded-2xl bg-surface-900/60 border border-brand-500/20 p-5 shadow-card transition-colors hover:border-brand-500/30", railTab !== "ai" && "hidden")}>
              <div className="pointer-events-none absolute -top-10 -right-10 h-32 w-32 rounded-full bg-brand-500/10 blur-2xl" />
              <h3 className="text-xs font-semibold text-accent-strong uppercase tracking-wider mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-accent-coral shadow-glow">
                  <Sparkles className="w-3 h-3 text-white" />
                </span>
                AI Content Studio
              </h3>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => generateAssist("headline")}
                  disabled={genBusy !== null || content.trim().length < 40}
                  className="flex flex-col items-center gap-1 rounded-lg bg-surface-800/60 border border-brand-500/20 px-2 py-2.5 type-caption text-accent-strong hover:bg-brand-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {genBusy === "headline" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />}
                  Headline
                </button>
                <button
                  onClick={() => generateAssist("excerpt")}
                  disabled={genBusy !== null || content.trim().length < 40}
                  className="flex flex-col items-center gap-1 rounded-lg bg-surface-800/60 border border-brand-500/20 px-2 py-2.5 type-caption text-accent-strong hover:bg-brand-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {genBusy === "excerpt" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlignLeft className="h-3.5 w-3.5" />}
                  Excerpt
                </button>
                <button
                  onClick={() => generateAssist("topics")}
                  disabled={genBusy !== null || content.trim().length < 40}
                  className="flex flex-col items-center gap-1 rounded-lg bg-surface-800/60 border border-brand-500/20 px-2 py-2.5 type-caption text-accent-strong hover:bg-brand-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {genBusy === "topics" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Tag className="h-3.5 w-3.5" />}
                  Topics
                </button>
              </div>                <button
                  onClick={runEnhance}
                  disabled={enhanceBusy || content.trim().length < 40}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-500/15 to-accent-coral/10 border border-brand-500/25 px-2 py-2 type-caption text-accent-strong hover:from-brand-500/25 hover:to-accent-coral/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                {enhanceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />}
                {enhanceBusy ? "Analyzing…" : "Enhance draft — readability & clarity"}
              </button>
              {enhancement && (
                <div className="mt-3 rounded-lg border border-surface-700/60 bg-surface-950/40 p-3">
                  <div className="flex items-center justify-between">
                    <span className="type-caption text-surface-400 uppercase tracking-wider">
                      Enhancement — grade {enhancement.grade}
                    </span>
                    <button onClick={() => setEnhancement(null)} className="text-surface-500 hover:text-surface-300">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-800">
                      <div
                        className={cn(
                          "h-1.5 rounded-full",
                          enhancement.score >= 75 ? "bg-emerald-500" : enhancement.score >= 50 ? "bg-amber-500" : "bg-red-500"
                        )}
                        style={{ width: `${enhancement.score}%` }}
                      />
                    </div>
                    <span className="type-caption text-surface-300">{enhancement.score}/100</span>
                  </div>
                  <p className="mt-2 type-caption text-surface-500">
                    {enhancement.readability.sentences} sentences · {enhancement.readability.words} words · avg{" "}
                    {enhancement.readability.avgSentenceWords} words/sentence
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
                    <p className="mt-2 type-meta text-emerald-400">Clean draft — no actionable suggestions. Nice.</p>
                  )}
                </div>
              )}
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
                    title="Click to use"
                  >
                    {generated.primary}
                  </button>
                  {generated.alternatives.map((alt, i) => (
                    <button
                      key={i}
                      onClick={() => applyGenerated(alt)}
                      className="block w-full text-left rounded-md bg-surface-800/60 border border-surface-700/50 px-3 py-2 text-xs text-surface-300 hover:border-brand-500/30 hover:text-brand-300 transition-all"
                      title="Click to use"
                    >
                      {alt}
                    </button>
                  ))}
                  <p className="text-[9px] text-surface-600">Click a suggestion to apply it.</p>
                </div>
              )}
            </div>

            <div className={cn("relative overflow-hidden rounded-2xl bg-surface-900/60 border border-accent-violet/25 p-5 shadow-card transition-colors hover:border-accent-violet/40", railTab !== "ai" && "hidden")}>
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
                Reads your draft and selection, then writes back directly into the editor.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => runCopilot("rewrite")}
                  disabled={copilotBusy !== null || content.trim().length < 20}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "rewrite" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Gauge className="h-3 w-3 text-brand-400" />}
                  Polish
                </button>
                <button
                  onClick={() => runCopilot("continue")}
                  disabled={copilotBusy !== null || content.trim().length < 20}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "continue" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3 text-accent-cyan" />}
                  Continue
                </button>
                <button
                  onClick={() => runCopilot("outline")}
                  disabled={copilotBusy !== null || content.trim().length < 20}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "outline" ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3 text-accent-amber" />}
                  Outline
                </button>
                <button
                  onClick={() => runCopilot("summarize")}
                  disabled={copilotBusy !== null || content.trim().length < 20}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "summarize" ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlignLeft className="h-3 w-3 text-accent-coral" />}
                  Excerpt
                </button>
                <button
                  onClick={() => runCopilot("headline")}
                  disabled={copilotBusy !== null || content.trim().length < 20}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "headline" ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3 text-brand-400" />}
                  Headline
                </button>
                <button
                  onClick={() => runCopilot("tags")}
                  disabled={copilotBusy !== null || content.trim().length < 20}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 px-2 py-2 type-caption text-surface-200 hover:border-brand-500/40 hover:text-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "tags" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tag className="h-3 w-3 text-accent-violet" />}
                  Tags
                </button>
                <button
                  onClick={() => runCopilot("curate")}
                  disabled={copilotBusy !== null}
                  className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet/15 to-brand-500/10 border border-accent-violet/25 px-2 py-2 type-caption text-accent-violet hover:from-accent-violet/25 hover:to-brand-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {copilotBusy === "curate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Curate — what to publish next
                </button>
              </div>

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
                  placeholder="Ask the brain… e.g. “write a stronger intro for my draft”"
                  rows={2}
                  className="flex-1 resize-none rounded-lg bg-surface-800/60 border border-surface-700/50 px-3 py-2 text-xs text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-accent-violet/40 transition-colors leading-relaxed"
                />
                <button
                  onClick={() => runCopilot("assist", true)}
                  disabled={copilotBusy !== null || !copilotPrompt.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent-violet to-brand-500 text-white shadow-glow hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 transition-all"
                  title="Ask the brain"
                >
                  {copilotBusy === "assist:prompt" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </button>
              </div>
              <p className="text-[9px] text-surface-600 mt-1.5">
                Try: “polish this”, “make the intro stronger”, “suggest a headline”, “what should I write about?”
              </p>

              {copilotError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                  <p className="type-caption text-red-300 leading-relaxed">{copilotError}</p>
                  <button onClick={() => setCopilotError(null)} className="ml-auto text-red-400 hover:text-red-300">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {copilotResult && (
                <div className="mt-3 rounded-lg border border-accent-violet/25 bg-surface-950/50 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="type-caption text-accent-violet uppercase tracking-wider">
                      {copilotResult.action === "rewrite"
                        ? "Polished draft"
                        : copilotResult.action === "continue"
                          ? "Continued draft"
                          : copilotResult.action === "outline"
                            ? "Outline"
                            : copilotResult.action === "summarize"
                              ? "Excerpt"
                              : copilotResult.action === "headline"
                                ? "Headline"
                                : copilotResult.action === "tags"
                                  ? "Tags"
                                  : copilotResult.action === "curate"
                                    ? "Curation brief"
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
                        title="Dismiss"
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
                    {copilotResult.action === "headline"
                      ? "Use as title"
                      : copilotResult.action === "summarize"
                        ? "Use as excerpt"
                        : copilotResult.action === "tags"
                          ? "Add tags"
                          : copilotResult.action === "rewrite"
                            ? "Replace draft"
                            : copilotResult.action === "continue"
                              ? "Append to draft"
                              : "Insert into editor"}
                  </button>
                </div>
              )}
            </div>

            <div className={cn("rounded-2xl bg-gradient-to-br from-brand-500/5 to-accent-amber/5 border border-brand-500/10 p-5", railTab !== "stories" && "hidden")}>
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
          </aside>
        </div>
      </div>
    </div>
  );
}