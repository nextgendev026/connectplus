"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Star,
  Loader2,
  RefreshCw,
  Rss,
  PenLine,
  CheckSquare,
  Square,
  CheckCircle2,
  FolderTree,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
}

interface AdminPost {
  id: string;
  title: string;
  slug: string;
  status: string;
  featured: boolean;
  coverImage: string | null;
  createdAt: string;
  publishedAt: string | null;
  category: { id: string; name: string; slug: string } | null;
  author: { username: string; name: string | null };
  source: string | null;
  sourceUrl: string | null;
  likes: number;
  comments: number;
}

const PAGE_SIZE = 40;

export default function AdminContentPage() {
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "rss" | "native">("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [featuredOnly, setFeaturedOnly] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        source: sourceFilter,
      });
      if (q.trim()) params.set("q", q.trim());
      if (categoryFilter) params.set("categoryId", categoryFilter);
      if (featuredOnly) params.set("featured", "true");

      const res = await fetch(`/api/admin/content?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setPosts(data.posts ?? []);
      setCategories(data.categories ?? []);
      setTotal(data.total ?? 0);
      setError(null);
    } catch {
      setError("Could not load content. Retry in a moment.");
    } finally {
      setLoading(false);
    }
  }, [page, q, sourceFilter, categoryFilter, featuredOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const allSelected = posts.length > 0 && posts.every((p) => selected.has(p.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(posts.map((p) => p.id)));
  }

  async function bulk(payload: Record<string, unknown>, label: string) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setWorking(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/content", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, ...payload }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Update failed");
      }
      const data = await res.json();
      setNotice(`${label} — ${data.updated} post${data.updated === 1 ? "" : "s"}`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setWorking(false);
    }
  }

  async function quickFeature(post: AdminPost) {
    setPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, featured: !p.featured } : p)));
    await fetch("/api/admin/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: post.id, featured: !post.featured }),
    }).catch(() => setError("Could not update that post"));
  }

  async function quickCategorise(post: AdminPost, categoryId: string) {
    setPosts((prev) => {
      const cat = categories.find((c) => c.id === categoryId);
      return prev.map((p) =>
        p.id === post.id ? { ...p, category: cat ? { id: cat.id, name: cat.name, slug: cat.slug } : null } : p
      );
    });
    await fetch("/api/admin/content", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: post.id, categoryId: categoryId || null }),
    }).catch(() => setError("Could not categorise that post"));
  }

  const pages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-surface-900 sm:text-2xl dark:text-surface-50">
            <Star className="h-5 w-5 text-brand-500" />
            Content Console
          </h1>
          <p className="mt-1 text-sm text-surface-500">
            Feature stories for the homepage and file fetched posts into categories.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-surface-200 px-3 py-2 text-sm font-medium text-surface-600 transition hover:border-brand-500/50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </button>
      </header>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </p>
      ) : null}

      {/* Filters */}
      <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            placeholder="Search titles…"
            className={cn(inputCls, "pl-9")}
          />
        </div>
        <select
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value as "all" | "rss" | "native");
            setPage(0);
          }}
          className={inputCls}
        >
          <option value="all">All sources</option>
          <option value="rss">Fetched (RSS)</option>
          <option value="native">Written on-platform</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value);
            setPage(0);
          }}
          className={inputCls}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            setFeaturedOnly((v) => !v);
            setPage(0);
          }}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition",
            featuredOnly
              ? "border-brand-500 bg-brand-500/10 text-brand-600"
              : "border-surface-200 text-surface-600 hover:border-surface-300"
          )}
        >
          <Star className={cn("h-4 w-4", featuredOnly && "fill-current")} />
          Featured only
        </button>
      </div>

      {/* Bulk bar */}
      {selected.size > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-brand-500/30 bg-brand-500/5 p-3">
          <span className="text-sm font-medium text-surface-700 dark:text-surface-200">
            {selected.size} selected
          </span>
          <button
            disabled={working}
            onClick={() => void bulk({ featured: true }, "Featured")}
            className={bulkBtn}
          >
            <Star className="h-3.5 w-3.5" /> Feature
          </button>
          <button
            disabled={working}
            onClick={() => void bulk({ featured: false }, "Unfeatured")}
            className={bulkBtn}
          >
            Unfeature
          </button>
          <select
            disabled={working}
            value=""
            onChange={(e) => e.target.value && void bulk({ categoryId: e.target.value }, "Categorised")}
            className="rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-surface-700 dark:bg-surface-900 dark:text-surface-100"
          >
            <option value="">Move to category…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {working ? <Loader2 className="h-4 w-4 animate-spin text-brand-500" /> : null}
        </div>
      ) : null}

      {/* List */}
      <div className="mt-4 overflow-hidden rounded-2xl border border-surface-200/70">
        <div className="hidden items-center gap-3 border-b border-surface-200/70 bg-surface-100/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-surface-500 sm:flex dark:bg-surface-900/40">
          <button onClick={toggleAll} className="shrink-0" aria-label="Select all">
            {allSelected ? <CheckSquare className="h-4 w-4 text-brand-500" /> : <Square className="h-4 w-4" />}
          </button>
          <span className="flex-1">Story</span>
          <span className="w-36">Category</span>
          <span className="w-20 text-center">Featured</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-surface-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : posts.length === 0 ? (
          <div className="py-12 text-center text-sm text-surface-500">No posts match these filters.</div>
        ) : (
          posts.map((post) => (
            <div
              key={post.id}
              className="flex flex-col gap-3 border-b border-surface-200/60 px-3 py-3 last:border-b-0 sm:flex-row sm:items-center dark:border-surface-800"
            >
              <button onClick={() => toggleOne(post.id)} className="hidden shrink-0 sm:block" aria-label="Select post">
                {selected.has(post.id) ? (
                  <CheckSquare className="h-4 w-4 text-brand-500" />
                ) : (
                  <Square className="h-4 w-4 text-surface-400" />
                )}
              </button>

              <div className="flex min-w-0 flex-1 items-start gap-3">
                <button onClick={() => toggleOne(post.id)} className="shrink-0 sm:hidden" aria-label="Select post">
                  {selected.has(post.id) ? (
                    <CheckSquare className="h-4 w-4 text-brand-500" />
                  ) : (
                    <Square className="h-4 w-4 text-surface-400" />
                  )}
                </button>

                {post.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.coverImage}
                    alt=""
                    className="h-11 w-16 shrink-0 rounded-lg border border-surface-200 object-cover"
                  />
                ) : (
                  <div className="flex h-11 w-16 shrink-0 items-center justify-center rounded-lg border border-surface-200 bg-surface-100 text-surface-400">
                    {post.sourceUrl ? <Rss className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
                  </div>
                )}

                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-medium text-surface-900 dark:text-surface-50">{post.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-surface-500">
                    <span>@{post.author.username}</span>
                    <span>·</span>
                    <span>{timeAgo(post.publishedAt ?? post.createdAt)}</span>
                    {post.source ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-200/60 px-1.5 py-0.5 text-[10px] font-medium text-surface-600">
                        <Rss className="h-3 w-3" /> {post.source}
                      </span>
                    ) : null}
                    <span className="text-[10px] uppercase tracking-wide text-surface-400">{post.status}</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:w-auto">
                <select
                  value={post.category?.id ?? ""}
                  onChange={(e) => void quickCategorise(post, e.target.value)}
                  className="rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-xs text-surface-700 dark:bg-surface-900 dark:text-surface-100"
                >
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => void quickFeature(post)}
                  title={post.featured ? "Remove from featured" : "Feature on homepage"}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition",
                    post.featured
                      ? "border-brand-500 bg-brand-500/10 text-brand-600"
                      : "border-surface-200 text-surface-500 hover:border-brand-500/50"
                  )}
                >
                  <Star className={cn("h-3.5 w-3.5", post.featured && "fill-current")} />
                  {post.featured ? "Featured" : "Feature"}
                </button>

                <a
                  href={`/article/${post.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-surface-200 px-2 py-1.5 text-xs font-medium text-surface-500 transition hover:border-surface-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View
                </a>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-sm text-surface-500">
        <span>
          {total === 0 ? "0" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)}`} of {total}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className={cn(pageBtn, "disabled:opacity-40")}
          >
            <ChevronLeft className="h-4 w-4" /> Prev
          </button>
          <span className="text-xs">
            {page + 1} / {pages}
          </span>
          <button
            disabled={page + 1 >= pages || loading}
            onClick={() => setPage((p) => p + 1)}
            className={cn(pageBtn, "disabled:opacity-40")}
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-surface-400">
        <FolderTree className="h-3.5 w-3.5" />
        Categories are managed from{" "}
        <a href="/admin/categories" className="font-medium text-brand-600 hover:underline">
          Categories
        </a>
        .
      </p>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-surface-200 bg-white px-3 py-2.5 text-sm text-surface-900 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:bg-surface-900 dark:text-surface-50";

const bulkBtn =
  "inline-flex items-center gap-1.5 rounded-lg border border-surface-200 bg-white px-2.5 py-1.5 text-xs font-medium text-surface-700 transition hover:border-brand-500/50 disabled:opacity-50 dark:bg-surface-900 dark:text-surface-100";

const pageBtn =
  "inline-flex items-center gap-1 rounded-lg border border-surface-200 px-2.5 py-1.5 text-xs font-medium text-surface-600 transition hover:border-brand-500/50";
