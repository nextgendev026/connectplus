"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Image from "next/image";
import {
  Rss,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  Download,
  CheckCircle,
  CheckCircle2,
  ImageIcon,
  Loader2,
  AlertTriangle,
  X,
  ToggleLeft,
  ToggleRight,
  Clock,
  Search,
  ChevronsUp,
  ChevronsDown,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

interface RssFeed {
  id: string;
  name: string;
  url: string;
  siteUrl: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  isActive: boolean;
  lastPolled: string | null;
  pollInterval: number;
  createdAt: string;
  /** Fetch health written by the poll pipeline (see src/lib/rss-poll.ts). */
  lastStatus: string | null;
  lastError: string | null;
  lastItemCount: number | null;
  lastNewArticles: number | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  httpEtag: string | null;
  _count?: { articles: number };
}

interface PipelineProgress {
  action: "poll" | "thumbnails";
  running: boolean;
  index: number;
  total: number;
  label: string;
  log: { name: string; status: string; newArticles: number }[];
}

interface RssArticle {
  id: string;
  feedId: string;
  title: string;
  url: string;
  content: string | null;
  summary: string | null;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
  importedAt: string;
  postId: string | null;
  feed: {
    id: string;
    name: string;
    category: string | null;
    icon: string | null;
  };
}

interface FeedStats {
  totalFeeds: number;
  totalArticles: number;
  importedCount: number;
  lastPollTime: string | null;
}

export default function RssAdminPage() {
  const articlesScrollRef = useRef<HTMLDivElement>(null);
  const [feeds, setFeeds] = useState<RssFeed[]>([]);
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollingFeedId, setPollingFeedId] = useState<string | null>(null);
  const [pollingAll, setPollingAll] = useState(false);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importCategoryFilter, setImportCategoryFilter] = useState<string>("");
  const [articleSearch, setArticleSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", url: "", category: "", description: "" });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [recovering, setRecovering] = useState(false);

  const stats: FeedStats = {
    totalFeeds: feeds.length,
    totalArticles: articles.length,
    importedCount: articles.filter((a) => a.postId).length,
    lastPollTime: feeds.reduce<string | null>((latest, f) => {
      if (!f.lastPolled) return latest;
      if (!latest || f.lastPolled > latest) return f.lastPolled;
      return latest;
    }, null),
  };

  const fetchFeeds = useCallback(async () => {
    try {
      const res = await fetch("/api/rss/feeds");
      if (!res.ok) throw new Error("Failed to fetch feeds");
      const data = await res.json();
      const feedList: RssFeed[] = data.feeds || [];
      setFeeds(feedList);
      const cats = Array.from(new Set(feedList.map((f) => f.category).filter(Boolean))) as string[];
      setCategories(cats);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const fetchArticles = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (importCategoryFilter) params.set("category", importCategoryFilter);
      const res = await fetch(`/api/rss/articles?${params}`);
      if (!res.ok) throw new Error("Failed to fetch articles");
      const data = await res.json();
      setArticles(data.articles || []);
    } catch (err) {
      console.error(err);
    }
  }, [importCategoryFilter]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        await Promise.all([fetchFeeds(), fetchArticles()]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [fetchFeeds, fetchArticles]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/filter-change: the sync setState is only an idempotent loading flag
    fetchArticles();
  }, [importCategoryFilter, fetchArticles]);

  /**
   * Drives the ingestion pipeline through its streaming endpoint so the console
   * can paint real progress instead of a spinner that lies. The old flow called
   * a fire-and-forget trigger: the button said "Polling…" for one round trip and
   * reported success even when the queue accepted the event and never ran it.
   */
  async function runPipeline(action: "poll" | "thumbnails", feedId?: string) {
    const params = new URLSearchParams({ action });
    if (feedId) params.set("feedId", feedId);
    setError(null);
    setProgress({ action, running: true, index: 0, total: 0, label: "Starting…", log: [] });

    try {
      const res = await fetch(`/api/rss/stream?${params.toString()}`, {
        headers: { Accept: "application/x-ndjson" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `Pipeline failed (${res.status})`);
      }
      if (!res.body) throw new Error("No progress stream available");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: {
            type: string;
            index?: number;
            total?: number;
            name?: string;
            status?: string;
            newArticles?: number;
            message?: string;
          };
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "error") throw new Error(event.message ?? "Pipeline failed");
          if (event.type === "start") {
            setProgress((prev) => (prev ? { ...prev, total: event.total ?? 0 } : prev));
          } else if (event.type === "feed" || event.type === "item") {
            setProgress((prev) =>
              prev
                ? {
                    ...prev,
                    index: event.index ?? prev.index,
                    total: event.total || prev.total,
                    label: event.name ?? prev.label,
                    log: [
                      {
                        name: event.name ?? "feed",
                        status: event.status ?? "OK",
                        newArticles: event.newArticles ?? 0,
                      },
                      ...prev.log,
                    ].slice(0, 8),
                  }
                : prev
            );
          }
        }
      }

      await Promise.all([fetchFeeds(), fetchArticles()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pipeline failed");
    } finally {
      setProgress((prev) => (prev ? { ...prev, running: false } : prev));
      window.setTimeout(() => setProgress(null), 5000);
    }
  }

  async function handlePollAll() {
    setPollingAll(true);
    try {
      await runPipeline("poll");
    } finally {
      setPollingAll(false);
    }
  }

  async function handlePollFeed(feedId: string) {
    setPollingFeedId(feedId);
    try {
      await runPipeline("poll", feedId);
    } finally {
      setPollingFeedId(null);
    }
  }

  async function handleRecoverThumbnails() {
    setRecovering(true);
    try {
      await runPipeline("thumbnails");
    } finally {
      setRecovering(false);
    }
  }

  async function handleToggleActive(feed: RssFeed) {
    try {
      const res = await fetch(`/api/rss/feeds`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedId: feed.id, isActive: !feed.isActive }),
      });
      if (res.ok) {
        setFeeds((prev) =>
          prev.map((f) =>
            f.id === feed.id ? { ...f, isActive: !f.isActive } : f
          )
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteFeed(feedId: string) {
    if (!confirm("Delete this feed and all its articles?")) return;
    try {
      const res = await fetch(`/api/rss/feeds?id=${feedId}`, { method: "DELETE" });
      if (res.ok) {
        setFeeds((prev) => prev.filter((f) => f.id !== feedId));
        await fetchArticles();
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAddFeed(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddError(null);
    try {
      const res = await fetch("/api/rss/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add feed");
      }
      await fetchFeeds();
      setShowAddModal(false);
      setAddForm({ name: "", url: "", category: "", description: "" });
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add feed");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleImport(articleId: string) {
    setImportingId(articleId);
    try {
      const body: { articleId: string; categoryId?: string } = { articleId };
      if (importCategoryFilter) body.categoryId = importCategoryFilter;
      const res = await fetch("/api/rss/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }
      setArticles((prev) =>
        prev.map((a) =>
          a.id === articleId ? { ...a, postId: "imported" } : a
        )
      );
    } catch (err) {
      console.error(err);
    } finally {
      setImportingId(null);
    }
  }

  const filteredArticles = articles.filter((a) => {
    if (!articleSearch) return true;
    const q = articleSearch.toLowerCase();
    return (
      a.title.toLowerCase().includes(q) ||
      a.feed.name.toLowerCase().includes(q) ||
      (a.summary && a.summary.toLowerCase().includes(q))
    );
  });

  function scrollArticles(direction: "top" | "bottom") {
    const el = articlesScrollRef.current;
    if (!el) return;
    el.scrollTo({
      top: direction === "bottom" ? el.scrollHeight : 0,
      behavior: "smooth",
    });
  }

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1600px] space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-400/10 border border-orange-400/20">
              <Rss className="h-6 w-6 text-orange-400" />
            </div>
            <div>
              <h1 className="type-display text-surface-50">RSS Feed Manager</h1>
              <p className="text-sm font-medium text-surface-400">
                Manage feeds, poll sources, import articles
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => fetchFeeds().then(fetchArticles)}
              disabled={loading}
              className="rounded-lg bg-surface-900 border border-surface-800 p-2 text-surface-400 transition-colors hover:text-surface-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-orange-400" />              <span className="ml-3 text-sm font-medium text-surface-300">Loading RSS data...</span>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12">
            <AlertTriangle className="mb-3 h-8 w-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs text-surface-300 transition-colors hover:text-surface-50"
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: "Total Feeds",
                  value: stats.totalFeeds,
                  color: "text-orange-400",
                  bg: "bg-orange-400/10",
                },
                {
                  label: "Total Articles",
                  value: stats.totalArticles,
                  color: "text-cyan-400",
                  bg: "bg-cyan-400/10",
                },
                {
                  label: "Imported",
                  value: stats.importedCount,
                  color: "text-accent-strong",
                  bg: "bg-brand-500/10",
                },
                {
                  label: "Last Poll",
                  value: stats.lastPollTime ? timeAgo(stats.lastPollTime) : "Never",
                  color: "text-purple-400",
                  bg: "bg-purple-400/10",
                },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl bg-surface-900/50 border border-surface-800 p-5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-surface-300">{stat.label}</p>
                      <p className="mt-1 text-2xl font-bold text-surface-50">
                        {typeof stat.value === "number" ? stat.value.toLocaleString() : stat.value}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg",
                        stat.bg
                      )}
                    >
                      <Rss className={cn("h-5 w-5", stat.color)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Live pipeline progress — real per-feed events streamed from
                /api/rss/stream, so a slow or failing feed is visible while it
                runs instead of after the fact. */}
            {progress && (
              <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-surface-100">
                    {progress.running ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-orange-400" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    )}
                    <span>
                      {progress.action === "poll" ? "Polling feeds" : "Recovering thumbnails"}
                    </span>
                    <span className="text-xs font-normal text-surface-500 tabular-nums">
                      {progress.total ? `${progress.index}/${progress.total}` : "…"}
                    </span>
                  </div>
                  <span className="max-w-full truncate text-xs text-surface-400 sm:max-w-[18rem]">
                    {progress.label}
                  </span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-800">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      progress.running
                        ? "bg-gradient-to-r from-orange-400 to-brand-500"
                        : "bg-emerald-500/70"
                    )}
                    style={{
                      width: progress.total
                        ? `${Math.min(100, Math.round((progress.index / progress.total) * 100))}%`
                        : "15%",
                    }}
                  />
                </div>
                {progress.log.length > 0 && (
                  <ul className="mt-3 grid gap-1 sm:grid-cols-2">
                    {progress.log.map((row, i) => (
                      <li
                        key={`${row.name}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-md bg-surface-800/40 px-2.5 py-1.5 text-xs"
                      >
                        <span className="truncate text-surface-200">{row.name}</span>
                        <span
                          className={cn(
                            "shrink-0 font-medium tabular-nums",
                            row.status === "OK" || row.status === "NOT_MODIFIED"
                              ? "text-emerald-400"
                              : row.status === "EMPTY" || row.status === "NONE"
                                ? "text-surface-400"
                                : "text-orange-400"
                          )}
                        >
                          {row.status}
                          {row.newArticles > 0 ? ` +${row.newArticles}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Feed Sources Panel */}
            <div className="rounded-xl bg-surface-900/50 border border-surface-800 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-800 px-4 py-4 sm:px-6">
                <div className="flex items-center gap-2">
                  <Rss className="h-5 w-5 text-orange-400" />
                  <h2 className="type-h2 text-surface-50">Feed Sources</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handlePollAll}
                    disabled={pollingAll}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      pollingAll
                        ? "bg-surface-800 text-surface-400 cursor-not-allowed"
                        : "bg-orange-400/10 border border-orange-400/20 text-orange-400 hover:bg-orange-400/20"
                    )}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", pollingAll && "animate-spin")} />
                    {pollingAll ? "Polling..." : "Poll All"}
                  </button>
                  <button
                    onClick={handleRecoverThumbnails}
                    disabled={recovering}
                    title="Fetch og:image for imported stories that have no thumbnail"
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                      recovering
                        ? "bg-surface-800 text-surface-400 cursor-not-allowed"
                        : "bg-cyan-400/10 border border-cyan-400/20 text-cyan-300 hover:bg-cyan-400/20"
                    )}
                  >
                    <ImageIcon className={cn("h-3.5 w-3.5", recovering && "animate-pulse")} />
                    <span className="hidden sm:inline">
                      {recovering ? "Recovering..." : "Recover thumbnails"}
                    </span>
                    <span className="sm:hidden">Thumbs</span>
                  </button>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-600"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Feed
                  </button>
                </div>
              </div>

              {feeds.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Rss className="mb-3 h-8 w-8 text-surface-600" />
                  <p className="text-sm font-medium text-surface-300">No feeds configured yet</p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="mt-3 text-xs text-accent-strong hover:text-brand-400"
                  >
                    Add your first feed
                  </button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-surface-800">
                        <th className="px-3 py-3 text-left text-xs font-medium text-surface-400 sm:px-5">
                          Feed
                        </th>
                        <th className="hidden px-5 py-3 text-left text-xs font-medium text-surface-400 md:table-cell">
                          Category
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-surface-400 sm:px-5">
                          Articles
                        </th>
                        <th className="hidden px-5 py-3 text-left text-xs font-medium text-surface-400 sm:table-cell">
                          Last Polled
                        </th>
                        <th className="px-3 py-3 text-left text-xs font-medium text-surface-400 sm:px-5">
                          Status
                        </th>
                        <th className="px-3 py-3 text-right text-xs font-medium text-surface-400 sm:px-5">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-800/50">
                      {feeds.map((feed) => (
                        <tr
                          key={feed.id}
                          className="transition-colors hover:bg-surface-800/30"
                        >
                          <td className="px-3 py-3.5 sm:px-5">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-surface-50">
                                {feed.name}
                              </p>
                              <p className="truncate text-xs text-surface-500 max-w-[300px]">
                                {feed.url}
                              </p>
                              {/* Fetch health — a feed that fails silently used to look fine here. */}
                              {feed.lastStatus && (
                                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                      feed.lastStatus === "OK" || feed.lastStatus === "NOT_MODIFIED"
                                        ? "bg-emerald-500/10 text-emerald-400"
                                        : feed.lastStatus === "EMPTY"
                                          ? "bg-surface-800 text-surface-400"
                                          : "bg-orange-500/10 text-orange-400"
                                    )}
                                  >
                                    {feed.lastStatus}
                                  </span>
                                  {typeof feed.lastNewArticles === "number" && (
                                    <span className="text-[10px] text-surface-500 tabular-nums">
                                      {feed.lastNewArticles} new
                                      {feed.lastItemCount ? ` / ${feed.lastItemCount} items` : ""}
                                      {feed.lastDurationMs ? ` · ${(feed.lastDurationMs / 1000).toFixed(1)}s` : ""}
                                    </span>
                                  )}
                                  {feed.consecutiveFailures > 1 && (
                                    <span className="text-[10px] font-medium text-red-400">
                                      {feed.consecutiveFailures} consecutive failures
                                    </span>
                                  )}
                                  {feed.lastError && (
                                    <span className="max-w-[16rem] truncate text-[10px] text-red-400" title={feed.lastError}>
                                      {feed.lastError}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="hidden px-5 py-3.5 md:table-cell">
                            {feed.category ? (
                              <span className="inline-flex rounded-full bg-surface-800 px-2 py-0.5 type-caption text-surface-200">
                                {feed.category}
                              </span>
                            ) : (
                              <span className="text-xs text-surface-600">-</span>
                            )}
                          </td>
                          <td className="px-3 py-3.5 text-sm font-medium text-surface-50 tabular-nums sm:px-5">
                            {feed._count?.articles ?? 0}
                          </td>
                          <td className="hidden px-5 py-3.5 text-xs font-medium text-surface-300 sm:table-cell">
                            {feed.lastPolled ? timeAgo(feed.lastPolled) : "Never"}
                          </td>
                          <td className="px-3 py-3.5 sm:px-5">
                            <button
                              onClick={() => handleToggleActive(feed)}
                              className="flex items-center gap-1.5"
                            >
                              {feed.isActive ? (
                                <ToggleRight className="h-5 w-5 text-accent-strong" />
                              ) : (
                                <ToggleLeft className="h-5 w-5 text-surface-500" />
                              )}
                              <span
                                className={cn(
                                  "type-caption",
                                  feed.isActive ? "text-accent-strong" : "text-surface-500"
                                )}
                              >
                                {feed.isActive ? "Active" : "Inactive"}
                              </span>
                            </button>
                          </td>
                          <td className="px-3 py-3.5 text-right sm:px-5">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handlePollFeed(feed.id)}
                                disabled={pollingFeedId === feed.id}
                                className={cn(
                                  "rounded-md p-1.5 transition-colors",
                                  pollingFeedId === feed.id
                                    ? "text-surface-600 cursor-not-allowed"
                                    : "text-surface-500 hover:bg-surface-800 hover:text-surface-50"
                                )}
                                title="Poll this feed"
                              >
                                <RefreshCw
                                  className={cn(
                                    "h-3.5 w-3.5",
                                    pollingFeedId === feed.id && "animate-spin"
                                  )}
                                />
                              </button>
                              {feed.siteUrl && (
                                <a
                                  href={feed.siteUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
                                  title="Visit site"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              )}
                              <button
                                onClick={() => handleDeleteFeed(feed.id)}
                                className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                                title="Delete feed"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Articles Panel */}
            <div className="rounded-xl bg-surface-900/50 border border-surface-800 overflow-hidden">
              <div className="border-b border-surface-800 px-6 py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Download className="h-5 w-5 text-cyan-400" />
                    <h2 className="type-h2 text-surface-50">
                      Recent Articles
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => scrollArticles("top")}
                      className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
                      title="Scroll to top"
                    >
                      <ChevronsUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => scrollArticles("bottom")}
                      className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
                      title="Scroll to bottom"
                    >
                      <ChevronsDown className="h-3.5 w-3.5" />
                    </button>
                    <span className="rounded-full bg-surface-800 px-2.5 py-1 text-xs font-semibold text-surface-200 tabular-nums">
                      {filteredArticles.length} articles
                    </span>
                  </div>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500" />
                    <input
                      value={articleSearch}
                      onChange={(e) => setArticleSearch(e.target.value)}
                      placeholder="Search articles..."
                      className="h-9 w-full rounded-lg bg-surface-800 border border-surface-700 pl-9 pr-4 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-orange-400/50"
                    />
                  </div>
                  <select
                    value={importCategoryFilter}
                    onChange={(e) => setImportCategoryFilter(e.target.value)}
                    className="h-9 rounded-lg bg-surface-800 border border-surface-700 px-3 text-sm font-medium text-surface-100 outline-none transition-colors focus:border-brand-500/50"
                  >
                    <option value="">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {filteredArticles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Download className="mb-3 h-8 w-8 text-surface-600" />
                  <p className="text-sm font-medium text-surface-300">No articles found</p>
                </div>
              ) : (
                <div
                  ref={articlesScrollRef}
                  className="divide-y divide-surface-800/50 max-h-[540px] overflow-y-auto overscroll-contain scroll-smooth"
                >
                  {filteredArticles.map((article) => (
                    <div
                      key={article.id}
                      className="flex items-start gap-4 px-6 py-4 transition-colors hover:bg-surface-800/20"
                    >
                      {article.imageUrl && (
                        <Image
                          src={article.imageUrl}
                          alt=""
                          width={64}
                          height={64}
                          className="h-16 w-16 shrink-0 rounded-lg object-cover border border-surface-800"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <h3 className="text-sm font-medium text-surface-50 line-clamp-2 flex-1">
                            {article.title}
                          </h3>
                          {article.postId && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand-500/10 border border-brand-500/20 px-2 py-0.5 type-caption text-accent-strong">
                              <CheckCircle className="h-2.5 w-2.5" />
                              Imported
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-surface-500">
                          <span className="inline-flex items-center gap-1">
                            <Rss className="h-3 w-3" />
                            {article.feed.name}
                          </span>
                          {article.publishedAt && (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {timeAgo(article.publishedAt)}
                            </span>
                          )}
                          {article.author && (
                            <span>{article.author}</span>
                          )}
                        </div>
                        {article.summary && (
                          <p className="mt-1.5 text-xs text-surface-300 line-clamp-2">
                            {article.summary}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-md p-1.5 text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
                          title="Open original"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        {!article.postId && (
                          <button
                            onClick={() => handleImport(article.id)}
                            disabled={importingId === article.id}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                              importingId === article.id
                                ? "bg-surface-800 text-surface-400 cursor-not-allowed"
                                : "bg-brand-500/10 border border-brand-500/20 text-accent-strong hover:bg-brand-500/20"
                            )}
                          >
                            {importingId === article.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            Import
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add Feed Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-surface-900 border border-surface-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-surface-800 px-6 py-4">
              <div className="flex items-center gap-2">
              <Rss className="h-5 w-5 text-orange-400" />
              <h2 className="type-h2 text-surface-50">Add RSS Feed</h2>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddError(null);
                }}
                className="rounded-lg p-1.5 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleAddFeed} className="p-6 space-y-4">
              {addError && (
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-xs text-red-400">
                  {addError}
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-surface-200">
                  Name *
                </label>
                <input
                  value={addForm.name}
                  onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. TechCrunch"
                  required
                  className="h-10 w-full rounded-lg bg-surface-800 border border-surface-700 px-4 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-orange-400/50 focus:ring-1 focus:ring-orange-400/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-surface-200">
                  RSS URL *
                </label>
                <input
                  value={addForm.url}
                  onChange={(e) => setAddForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com/feed.xml"
                  required
                  className="h-10 w-full rounded-lg bg-surface-800 border border-surface-700 px-4 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-orange-400/50 focus:ring-1 focus:ring-orange-400/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-surface-200">
                  Category
                </label>
                <input
                  value={addForm.category}
                  onChange={(e) => setAddForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Technology, News"
                  className="h-10 w-full rounded-lg bg-surface-800 border border-surface-700 px-4 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-orange-400/50 focus:ring-1 focus:ring-orange-400/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-surface-200">
                  Description
                </label>
                <textarea
                  value={addForm.description}
                  onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional description..."
                  rows={3}
                  className="w-full rounded-lg bg-surface-800 border border-surface-700 px-4 py-2.5 text-sm text-surface-50 placeholder-surface-500 outline-none transition-colors focus:border-orange-400/50 focus:ring-1 focus:ring-orange-400/20 resize-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setAddError(null);
                  }}
                  className="rounded-lg bg-surface-800 border border-surface-700 px-4 py-2 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-700 hover:text-surface-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-white transition-colors",
                    addLoading
                      ? "bg-surface-700 cursor-not-allowed"
                      : "bg-brand-500 hover:bg-brand-600"
                  )}
                >
                  {addLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Add Feed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
