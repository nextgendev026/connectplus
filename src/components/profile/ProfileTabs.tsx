"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import {
  Eye,
  FileText,
  Bookmark,
  Info,
  Heart,
  MessageCircle,
  TrendingUp,
  PenLine,
  LayoutGrid,
  Rows3,
  Clock,
  Sparkles,
  Search,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ProfilePostCard } from "./ProfilePostCard";
import type { ProfileTabPost } from "./ProfilePostCard";
import { ProfileListModal } from "./ProfileListModal";

export type { ProfileTabPost };

export interface ProfileStats {
  totalViews: number;
  totalLikes: number;
}

interface ProfileTabsProps {
  username: string;
  ownProfile: boolean;
  stats: ProfileStats;
  about?: string | null;
  displayName?: string;
  children?: React.ReactNode;
}

type SortKey = "latest" | "popular" | "liked";

const TABS = [
  { id: "posts", label: "Stories", icon: FileText },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "about", label: "About", icon: Info },
  { id: "stats", label: "Insights", icon: TrendingUp },
] as const;

type TabId = (typeof TABS)[number]["id"];

const SORTS: { id: SortKey; label: string }[] = [
  { id: "latest", label: "Latest" },
  { id: "popular", label: "Most read" },
  { id: "liked", label: "Most liked" },
];

export function ProfileTabs({
  username,
  ownProfile,
  stats,
  about,
  displayName,
  children,
}: ProfileTabsProps) {
  const [active, setActive] = useState<TabId>("posts");
  const [sort, setSort] = useState<SortKey>("latest");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [query, setQuery] = useState("");

  const visibleTabs = TABS.filter((t) => !(t.id === "saved" && !ownProfile));

  return (
    <div className="-mx-4 sm:mx-0">
      {/* ── Sticky tab bar ─────────────────────────────────────────── */}
      <div className="sticky top-12 z-30 border-b border-surface-800/70 bg-surface-950/85 backdrop-blur-xl sm:top-2 sm:rounded-2xl sm:border sm:border-surface-800/70 sm:bg-surface-900/70">
        <div className="flex items-center gap-0.5 overflow-x-auto scrollbar-hide px-1 sm:gap-1 sm:px-2">
          {visibleTabs.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                aria-selected={isActive}
                role="tab"
                className={cn(
                  "relative flex shrink-0 items-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors sm:gap-1.5 sm:px-3.5 sm:py-2.5 sm:text-sm",
                  isActive ? "text-brand-400" : "text-surface-500 hover:text-surface-200"
                )}
              >
                <tab.icon className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", isActive && "text-brand-400")} />
                {tab.label}
                {isActive && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-500 sm:bottom-1 sm:inset-x-3" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Panels ─────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 sm:px-0 sm:pt-6">
        {active === "posts" && (
          <LazyPostsPanel
            username={username}
            sort={sort}
            setSort={setSort}
            layout={layout}
            setLayout={setLayout}
            query={query}
            setQuery={setQuery}
            isGrid={layout === "grid"}
            displayName={displayName}
          />
        )}

        {active === "saved" && ownProfile && (
          <LazySavedPanel
            username={username}
            sort={sort}
            setSort={setSort}
            layout={layout}
            setLayout={setLayout}
            query={query}
            setQuery={setQuery}
            isGrid={layout === "grid"}
            displayName={displayName}
          />
        )}

        {active === "about" && (
          <div className="mx-auto max-w-2xl animate-fade-in space-y-4">
            <div className="rounded-2xl border border-surface-800/70 bg-surface-900/50 p-5 sm:p-6">
              <h3 className="type-label mb-3 flex items-center gap-2 uppercase tracking-wider text-surface-500">
                <Info className="h-3.5 w-3.5 text-brand-400" />
                Bio
              </h3>
              {about ? (
                <p className="text-sm leading-relaxed text-surface-300">{about}</p>
              ) : (
                <p className="text-sm italic text-surface-500">
                  {ownProfile
                    ? "Tell readers who you are — add a bio in settings."
                    : "This writer hasn't added a bio yet."}
                </p>
              )}
              {ownProfile && (
                <Link
                  href="/settings"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-surface-700 bg-surface-800/60 px-3.5 py-2 text-xs font-medium text-surface-300 transition-colors hover:border-brand-500/40 hover:text-brand-400"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Edit profile
                </Link>
              )}
            </div>
            {children}
          </div>
        )}

        {active === "stats" && (
          <LazyInsightsPanel username={username} ownProfile={ownProfile} displayName={displayName} />
        )}
      </div>
    </div>
  );
}

/* ── Lazy-loading posts panel ─────────────────────────────────────── */

function LazyPostsPanel({
  username,
  sort,
  setSort,
  layout,
  setLayout,
  query,
  setQuery,
  isGrid,
  displayName,
}: {
  username: string;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  layout: "grid" | "list";
  setLayout: (l: "grid" | "list") => void;
  query: string;
  setQuery: (q: string) => void;
  isGrid: boolean;
  displayName?: string;
}) {
  const [posts, setPosts] = useState<ProfileTabPost[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<HTMLDivElement | null>(null);
  const queryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on sort/query change
  useEffect(() => {
    setPosts([]);
    setPage(1);
    setHasMore(true);
  }, [sort, query]);

  // Fetch page
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      tab: "posts",
      page: String(page),
      sort,
    });
    if (query) params.set("q", query);

    fetch(`/api/profile/${username}?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPosts((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          return [...prev, ...data.items.filter((p: ProfileTabPost) => !existing.has(p.id))];
        });
        setTotal(data.total);
        setHasMore(page < data.totalPages);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [username, page, sort, query]);

  // Infinite scroll
  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loading) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  return (
    <PostsPanel
      posts={posts}
      totalCount={total}
      sort={sort}
      setSort={setSort}
      layout={layout}
      setLayout={setLayout}
      query={query}
      setQuery={setQuery}
      isGrid={isGrid}
      displayName={displayName}
      emptyKind="posts"
      loading={loading}
      observerRef={observerRef}
    />
  );
}

/* ── Lazy-loading saved panel ─────────────────────────────────────── */

function LazySavedPanel({
  username,
  sort,
  setSort,
  layout,
  setLayout,
  query,
  setQuery,
  isGrid,
  displayName,
}: {
  username: string;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  layout: "grid" | "list";
  setLayout: (l: "grid" | "list") => void;
  query: string;
  setQuery: (q: string) => void;
  isGrid: boolean;
  displayName?: string;
}) {
  const [posts, setPosts] = useState<ProfileTabPost[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPosts([]);
    setPage(1);
    setHasMore(true);
  }, [sort, query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      tab: "saved",
      page: String(page),
      sort,
    });
    if (query) params.set("q", query);

    fetch(`/api/profile/${username}?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPosts((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          return [...prev, ...data.items.filter((p: ProfileTabPost) => !existing.has(p.id))];
        });
        setTotal(data.total);
        setHasMore(page < data.totalPages);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [username, page, sort, query]);

  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loading) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "300px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  return (
    <PostsPanel
      posts={posts}
      totalCount={total}
      sort={sort}
      setSort={setSort}
      layout={layout}
      setLayout={setLayout}
      query={query}
      setQuery={setQuery}
      isGrid={isGrid}
      displayName={displayName}
      emptyKind="saved"
      loading={loading}
      observerRef={observerRef}
    />
  );
}

/* ── Shared posts panel UI ────────────────────────────────────────── */

function PostsPanel({
  posts,
  totalCount,
  sort,
  setSort,
  layout,
  setLayout,
  query,
  setQuery,
  isGrid,
  displayName,
  emptyKind,
  loading,
  observerRef,
}: {
  posts: ProfileTabPost[];
  totalCount: number;
  sort: SortKey;
  setSort: (s: SortKey) => void;
  layout: "grid" | "list";
  setLayout: (l: "grid" | "list") => void;
  query: string;
  setQuery: (q: string) => void;
  isGrid: boolean;
  displayName?: string;
  emptyKind: "posts" | "saved" | "no-results";
  loading: boolean;
  observerRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="animate-fade-in">
      {/* Toolbar */}
      {totalCount > 0 || loading ? (
        <div className="mb-3 flex flex-col gap-2.5 sm:mb-4 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-surface-500 sm:h-3.5 sm:w-3.5" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stories…"
              className="w-full rounded-xl border border-surface-800 bg-surface-900/60 py-1.5 pl-8 pr-3 text-xs text-surface-100 placeholder-surface-500 outline-none transition-colors focus:border-brand-500/60 focus:ring-1 focus:ring-brand-500/30 sm:py-2 sm:pl-9"
            />
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex rounded-xl border border-surface-800 bg-surface-900/60 p-0.5">
              {SORTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className={cn(
                    "rounded-lg px-2 py-1 text-[10px] font-medium transition-colors sm:px-2.5 sm:py-1.5 sm:text-[11px]",
                    sort === s.id
                      ? "bg-brand-500/15 text-brand-400"
                      : "text-surface-500 hover:text-surface-200"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex rounded-xl border border-surface-800 bg-surface-900/60 p-0.5">
              <button
                onClick={() => setLayout("grid")}
                aria-label="Grid view"
                className={cn(
                  "rounded-lg p-1.5 transition-colors",
                  isGrid ? "bg-brand-500/15 text-brand-400" : "text-surface-500 hover:text-surface-200"
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setLayout("list")}
                aria-label="List view"
                className={cn(
                  "rounded-lg p-1.5 transition-colors",
                  !isGrid ? "bg-brand-500/15 text-brand-400" : "text-surface-500 hover:text-surface-200"
                )}
              >
                <Rows3 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Cards */}
      {posts.length > 0 ? (
        <div
          className={cn(
            "gap-4",
            isGrid ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col"
          )}
        >
          {posts.map((post, i) => (
            <div
              key={post.id}
              className="animate-fade-in-up"
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            >
              <ProfilePostCard post={post} layout={isGrid ? "grid" : "list"} />
            </div>
          ))}
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} isGrid={isGrid} />
          ))}
        </div>
      ) : (
        <ProfileEmptyState kind={query ? "no-results" : emptyKind} displayName={displayName} />
      )}

      {/* Infinite scroll sentinel */}
      <div ref={observerRef} className="h-4" />

      {loading && posts.length > 0 && (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
        </div>
      )}
    </div>
  );
}

/* ── Skeleton card ────────────────────────────────────────────────── */

function SkeletonCard({ isGrid }: { isGrid: boolean }) {
  const isList = !isGrid;
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-surface-800/40 bg-surface-900/40",
        isList ? "flex flex-row" : "flex flex-col"
      )}
    >
      <div
        className={cn(
          "shrink-0 animate-pulse bg-surface-800/50",
          isList ? "h-auto w-28 sm:w-36" : "h-36"
        )}
      />
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <div className="mb-2 h-2 w-16 animate-pulse rounded-full bg-surface-800/50" />
        <div className="mb-1 h-4 w-3/4 animate-pulse rounded bg-surface-800/50" />
        <div className="mb-1 h-4 w-1/2 animate-pulse rounded bg-surface-800/50" />
        {!isList && <div className="mt-2 h-3 w-full animate-pulse rounded bg-surface-800/30" />}
        <div className="mt-auto flex gap-3 pt-3">
          <div className="h-2.5 w-10 animate-pulse rounded bg-surface-800/30" />
          <div className="h-2.5 w-8 animate-pulse rounded bg-surface-800/30" />
        </div>
      </div>
    </div>
  );
}

/* ── Lazy-loading insights panel ──────────────────────────────────── */

function LazyInsightsPanel({
  username,
  ownProfile,
  displayName,
}: {
  username: string;
  ownProfile: boolean;
  displayName?: string;
}) {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [posts, setPosts] = useState<ProfileTabPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/profile/${username}?tab=posts&page=1&sort=popular`).then((r) => r.json()),
    ])
      .then(([postsData]) => {
        if (cancelled) return;
        setPosts(postsData.items ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-2xl border border-surface-800/40 bg-surface-900/40"
          />
        ))}
      </div>
    );
  }

  // Simple insights from loaded data
  return <InsightsPanelLite posts={posts} ownProfile={ownProfile} displayName={displayName} />;
}

/* ── Simplified insights (no extra DB call needed) ────────────────── */

function InsightsPanelLite({
  posts,
  ownProfile,
  displayName,
}: {
  posts: ProfileTabPost[];
  ownProfile: boolean;
  displayName?: string;
}) {
  const totalPosts = posts.length;
  const totalViews = posts.reduce((s, p) => s + p.viewCount, 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likeCount ?? 0), 0);
  const avgViews = totalPosts > 0 ? Math.round(totalViews / totalPosts) : 0;
  const engagement =
    totalViews > 0 ? Math.min(100, (totalLikes / totalViews) * 100) : 0;

  const headline = [
    { label: "Avg views", value: avgViews, icon: Eye },
    { label: "Total likes", value: totalLikes, icon: Heart },
    { label: "Stories", value: totalPosts, icon: FileText },
    { label: "Engagement", value: Number(engagement.toFixed(1)), icon: TrendingUp },
  ];

  return (
    <div className="animate-fade-in space-y-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {headline.map((m) => (
          <div
            key={m.label}
            className="rounded-2xl border border-surface-800/70 bg-surface-900/50 p-3 transition-colors hover:border-surface-700 sm:p-4"
          >
            <m.icon className="mb-1.5 h-3.5 w-3.5 text-brand-400 sm:mb-2 sm:h-4 sm:w-4" />
            <p className="text-lg font-bold tabular-nums text-surface-50 sm:text-xl md:text-2xl">
              {typeof m.value === "number" && m.label === "Engagement"
                ? `${m.value}%`
                : m.value.toLocaleString()}
            </p>
            <p className="mt-0.5 text-[10px] font-medium text-surface-500 sm:text-[11px]">
              {m.label}
            </p>
          </div>
        ))}
      </div>

      {ownProfile && totalPosts === 0 && (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-surface-800 p-8 text-center">
          <p className="text-sm text-surface-400">
            No published stories yet — your insights will light up as you publish.
          </p>
          <Link
            href="/studio"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:bg-brand-600 hover:scale-[1.02]"
          >
            <PenLine className="h-4 w-4" />
            Write your first story
          </Link>
        </div>
      )}

      {ownProfile && totalPosts > 0 && (
        <p className="text-center text-[11px] text-surface-600">
          Insights are private to you, {displayName?.split(" ")[0] ?? "writer"} — only
          published stories are counted.
        </p>
      )}
    </div>
  );
}

/* ── Empty states ──────────────────────────────────────────────────── */

function ProfileEmptyState({
  kind,
  displayName,
}: {
  kind: "posts" | "saved" | "no-results";
  displayName?: string;
}) {
  const firstName = displayName?.split(" ")[0];

  if (kind === "no-results") {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-surface-800 p-10 text-center">
        <Search className="mb-3 h-6 w-6 text-surface-600" />
        <p className="text-sm text-surface-500">No stories match your search.</p>
      </div>
    );
  }

  if (kind === "saved") {
    return (
      <div className="flex flex-col items-center rounded-2xl border border-dashed border-surface-800 p-10 text-center">
        <Bookmark className="mb-3 h-6 w-6 text-surface-600" />
        <p className="text-sm font-medium text-surface-300">Nothing saved yet</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-surface-500">
          Tap the bookmark icon on any story to keep it here for later.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-surface-700 bg-surface-800/60 px-4 py-2 text-xs font-medium text-surface-300 transition-colors hover:border-brand-500/40 hover:text-brand-400"
        >
          Browse stories
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-surface-800 p-10 text-center">
      <FileText className="mb-3 h-6 w-6 text-surface-600" />
      <p className="text-sm font-medium text-surface-300">No stories yet</p>
      <p className="mt-1 max-w-xs text-xs leading-relaxed text-surface-500">
        {firstName
          ? `${firstName} hasn't published a story yet.`
          : "This writer hasn't published a story yet."}
      </p>
    </div>
  );
}
