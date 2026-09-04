"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Upload,
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
  Check,
  ChevronDown,
  Tag,
  PenLine,
  AlertCircle,
} from "lucide-react";

const writingTips = [
  "Start with a compelling hook — your first sentence determines if readers stay.",
  "Use subheadings to break up long sections and guide the reader.",
  "Include specific details: names, dates, and locations add credibility.",
  "Write in active voice for more engaging and direct prose.",
  "End with a clear call to action or thought-provoking question.",
  "Read your piece aloud to catch awkward phrasing and rhythm issues.",
];

interface Category {
  id: string;
  name: string;
  slug: string;
}

export default function StudioPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [category, setCategory] = useState("");
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [autoSaved, setAutoSaved] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/posts?limit=100")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.posts) return;
        const map = new Map<string, Category>();
        for (const post of data.posts) {
          if (post.category && !map.has(post.category.id)) {
            map.set(post.category.id, post.category);
          }
        }
        setCategoriesList(Array.from(map.values()));
      })
      .catch(() => {});
  }, []);

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

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => setCoverImage(ev.target?.result as string);
        reader.readAsDataURL(file);
        setCoverFile(file);
      }
    },
    []
  );

  const handleAutoSave = useCallback(() => {
    setAutoSaved(true);
    const now = new Date();
    setLastSaved(
      now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    );
    setTimeout(() => setAutoSaved(false), 2000);
  }, []);

  useEffect(() => {
    if (title || content) {
      const timer = setTimeout(handleAutoSave, 3000);
      return () => clearTimeout(timer);
    }
  }, [title, content, handleAutoSave]);

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  async function uploadCoverImage(): Promise<string | null> {
    if (!coverFile) return coverImage;
    const formData = new FormData();
    formData.append("file", coverFile);
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Upload failed" }));
      throw new Error(err.error || "Failed to upload image");
    }
    const data = await res.json();
    return data.url;
  }

  async function publishPost(postStatus: "published" | "draft") {
    setError(null);
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!content.trim()) {
      setError("Content is required");
      return;
    }

    if (postStatus === "published") {
      setIsPublishing(true);
    } else {
      setIsSavingDraft(true);
    }

    try {
      let uploadedCoverUrl: string | null = null;
      if (coverFile) {
        uploadedCoverUrl = await uploadCoverImage();
      } else if (coverImage) {
        uploadedCoverUrl = coverImage;
      }

      const matchedCategory = categoriesList.find(
        (c) => c.name === category
      );

      const body = {
        title: title.trim(),
        content: content.trim(),
        excerpt: excerpt.trim() || null,
        coverImage: uploadedCoverUrl,
        categoryId: matchedCategory?.id ?? null,
        tags: tags,
        status: postStatus.toUpperCase(),
      };

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      router.push(`/article/${data.post.slug}`);
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setIsPublishing(false);
      setIsSavingDraft(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Top Bar */}
      <div className="sticky top-0 z-40 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Link>
            <div className="h-5 w-px bg-surface-800" />
            <div className="flex items-center gap-2">
              <PenLine className="w-4 h-4 text-brand-400" />
              <span className="text-sm font-medium text-surface-50">
                Story Studio
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Auto-save indicator */}
            <div className="flex items-center gap-2 text-xs">
              {autoSaved ? (
                <span className="flex items-center gap-1 text-brand-400">
                  <Check className="w-3 h-3" />
                  Saved
                </span>
              ) : lastSaved ? (
                <span className="flex items-center gap-1 text-surface-500">
                  <Clock className="w-3 h-3" />
                  Saved at {lastSaved}
                </span>
              ) : null}
            </div>

            <button
              onClick={() => setShowPreview(!showPreview)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border",
                showPreview
                  ? "bg-brand-500/10 border-brand-500/30 text-brand-400"
                  : "border-surface-700 text-surface-400 hover:text-surface-50"
              )}
            >
              {showPreview ? (
                <EyeOff className="w-3.5 h-3.5" />
              ) : (
                <Eye className="w-3.5 h-3.5" />
              )}
              {showPreview ? "Edit" : "Preview"}
            </button>

            <button
              onClick={() => publishPost("draft")}
              disabled={isPublishing || isSavingDraft || !title.trim()}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors",
                isSavingDraft
                  ? "border-brand-500/30 text-brand-400 bg-brand-500/10"
                  : "border-surface-700 text-surface-400 hover:text-surface-50",
                (isPublishing || isSavingDraft || !title.trim()) &&
                  "opacity-50 cursor-not-allowed"
              )}
            >
              {isSavingDraft ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving...
                </span>
              ) : (
                "Save Draft"
              )}
            </button>

            <button
              onClick={() => publishPost("published")}
              disabled={isPublishing || isSavingDraft || !title.trim()}
              className={cn(
                "rounded-lg px-5 py-1.5 text-xs font-semibold transition-all",
                isPublishing || isSavingDraft || !title.trim()
                  ? "bg-surface-800 text-surface-500 cursor-not-allowed"
                  : "bg-brand-500 text-white hover:bg-brand-600 shadow-glow"
              )}
            >
              {isPublishing ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Publishing...
                </span>
              ) : (
                "Publish"
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-8">
          {/* Editor */}
          <div className="space-y-6">
            {showPreview ? (
              /* Preview Mode */
              <div className="rounded-2xl bg-surface-900/60 border border-surface-800/50 p-8 min-h-[60vh]">
                <h1 className="text-3xl font-display font-bold text-surface-50 mb-4">
                  {title || "Untitled Story"}
                </h1>
                <div className="flex items-center gap-3 text-xs text-surface-500 mb-6">
                  <span className="inline-flex items-center rounded-full bg-brand-500/15 px-2.5 py-0.5 text-brand-400 border border-brand-500/20">
                    {category || "Uncategorized"}
                  </span>
                  <span>{readTime} min read</span>
                  <span>{wordCount} words</span>
                </div>
                {coverImage && (
                  <div className="rounded-xl overflow-hidden mb-6">
                    <img
                      src={coverImage}
                      alt="Cover"
                      className="w-full h-64 object-cover"
                    />
                  </div>
                )}
                <div className="prose-custom space-y-4 text-[15px] text-surface-300 leading-[1.8] whitespace-pre-wrap">
                  {content || (
                    <p className="text-surface-600 italic">
                      Start writing to see your story come to life...
                    </p>
                  )}
                </div>
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-surface-800/50">
                    {tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-surface-800/60 px-3 py-1 text-xs text-surface-400"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Edit Mode */
              <>
                {/* Cover Image Upload */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={cn(
                    "relative rounded-2xl border-2 border-dashed transition-all overflow-hidden",
                    coverImage
                      ? "border-brand-500/30"
                      : isDragOver
                        ? "border-brand-500 bg-brand-500/5"
                        : "border-surface-700/50 hover:border-surface-600"
                  )}
                >
                  {coverImage ? (
                    <div className="relative">
                      <img
                        src={coverImage}
                        alt="Cover"
                        className="w-full h-48 object-cover"
                      />
                      <div className="absolute inset-0 bg-surface-950/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                        <label className="cursor-pointer rounded-lg bg-surface-950/80 backdrop-blur-sm px-4 py-2 text-xs font-medium text-surface-50 hover:bg-surface-950 transition-colors border border-surface-700">
                          Change Image
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="hidden"
                          />
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
                    <label className="cursor-pointer flex flex-col items-center justify-center py-16 px-6">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        className="hidden"
                      />
                      <div
                        className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition-colors",
                          isDragOver
                            ? "bg-brand-500/20 text-brand-400"
                            : "bg-surface-800/60 text-surface-500"
                        )}
                      >
                        <Upload className="w-5 h-5" />
                      </div>
                      <p className="text-sm font-medium text-surface-400 mb-1">
                        {isDragOver
                          ? "Drop your image here"
                          : "Upload a cover image"}
                      </p>
                      <p className="text-xs text-surface-600">
                        Drag and drop, or click to browse · JPG, PNG up to 10MB
                      </p>
                    </label>
                  )}
                </div>

                {/* Title */}
                <input
                  type="text"
                  placeholder="Your story title..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-transparent text-3xl md:text-4xl font-display font-bold text-surface-50 placeholder:text-surface-700 focus:outline-none"
                />

                {/* Formatting Toolbar */}
                <div className="flex items-center gap-1 p-2 rounded-xl bg-surface-900/60 border border-surface-800/50">
                  {[
                    Bold,
                    Italic,
                    Heading1,
                    Heading2,
                    List,
                    ListOrdered,
                    Quote,
                    Code,
                    Link2,
                    ImageIcon,
                  ].map((Icon, i) => (
                    <button
                      key={i}
                      className="p-2 rounded-lg text-surface-500 hover:text-surface-50 hover:bg-surface-800/60 transition-colors"
                    >
                      <Icon className="w-4 h-4" />
                    </button>
                  ))}
                  <div className="h-5 w-px bg-surface-800 mx-1" />
                  <span className="text-[10px] text-surface-600 px-2">
                    Markdown supported
                  </span>
                </div>

                {/* Content Editor */}
                <textarea
                  placeholder="Start writing your story... Share your perspective on technology, culture, business, or life in East Africa."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={20}
                  className="w-full bg-surface-900/40 border border-surface-800/50 rounded-2xl px-6 py-5 text-[15px] text-surface-300 placeholder:text-surface-700 focus:outline-none focus:border-brand-500/30 resize-none leading-[1.8] transition-colors"
                />

                {/* Excerpt */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-surface-400">
                    Excerpt
                  </label>
                  <textarea
                    placeholder="A brief summary of your story (shown in feeds and search results)..."
                    value={excerpt}
                    onChange={(e) => setExcerpt(e.target.value)}
                    rows={3}
                    maxLength={300}
                    className="w-full bg-surface-900/40 border border-surface-800/50 rounded-xl px-4 py-3 text-sm text-surface-300 placeholder:text-surface-700 focus:outline-none focus:border-brand-500/30 resize-none leading-relaxed transition-colors"
                  />
                  <p className="text-[10px] text-surface-600 text-right">
                    {excerpt.length}/300
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Sidebar */}
          <aside className="hidden lg:block space-y-6">
            {/* Status */}
            <div className="rounded-2xl bg-surface-900/60 border border-surface-800/50 p-5">
              <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3">
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
                      {category || "Select category"}
                      <ChevronDown className="w-3 h-3" />
                    </button>
                    {categoryOpen && (
                      <div className="absolute top-full right-0 mt-1 w-44 rounded-xl bg-surface-800 border border-surface-700 shadow-xl z-10 py-1">
                        {categoriesList.length > 0
                          ? categoriesList.map((cat) => (
                              <button
                                key={cat.id}
                                onClick={() => {
                                  setCategory(cat.name);
                                  setCategoryOpen(false);
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-2 text-xs transition-colors",
                                  category === cat.name
                                    ? "text-brand-400 bg-brand-500/10"
                                    : "text-surface-400 hover:text-surface-50 hover:bg-surface-700/50"
                                )}
                              >
                                {cat.name}
                              </button>
                            ))
                          : [
                              "Technology",
                              "Culture",
                              "Business",
                              "Lifestyle",
                              "Sports",
                              "Music",
                              "Food",
                              "Travel",
                            ].map((cat) => (
                              <button
                                key={cat}
                                onClick={() => {
                                  setCategory(cat);
                                  setCategoryOpen(false);
                                }}
                                className={cn(
                                  "w-full text-left px-3 py-2 text-xs transition-colors",
                                  category === cat
                                    ? "text-brand-400 bg-brand-500/10"
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
                  <span className="text-xs font-medium text-surface-300">
                    {wordCount}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-surface-400">Read time</span>
                  <span className="text-xs font-medium text-surface-300">
                    {readTime} min
                  </span>
                </div>
              </div>
            </div>

            {/* Tags */}
            <div className="rounded-2xl bg-surface-900/60 border border-surface-800/50 p-5">
              <h3 className="text-xs font-semibold text-surface-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Tag className="w-3 h-3" />
                Tags
              </h3>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-500/15 px-2.5 py-1 text-xs text-brand-400 border border-brand-500/20"
                  >
                    #{tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="hover:text-brand-300 transition-colors"
                    >
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
                  className="flex-1 bg-surface-800/40 border border-surface-700/50 rounded-lg px-3 py-1.5 text-xs text-surface-300 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/30 transition-colors"
                />
                <button
                  onClick={handleAddTag}
                  disabled={!tagInput.trim() || tags.length >= 10}
                  className="p-1.5 rounded-lg bg-surface-800/60 border border-surface-700/50 text-surface-400 hover:text-brand-400 hover:border-brand-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-surface-600 mt-2">
                Press Enter to add · {tags.length}/10 tags
              </p>
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
                    <p className="text-[11px] text-surface-400 leading-relaxed">
                      {tip}
                    </p>
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
