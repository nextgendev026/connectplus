"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Newspaper, Infinity as InfinityIcon } from "lucide-react";
import { cn, estimateReadTime } from "@/lib/utils";

interface LoadedPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImage: string | null;
  viewCount: number;
  createdAt: string;
  source?: string | null;
  sourceUrl?: string | null;
  author: { name: string | null; username: string; avatar: string | null };
  category: { name: string; slug: string } | null;
  _count: { comments: number; likes: number };
}

interface LoadMoreFeedProps {
  initialIds: string[];
  /** First API page to fetch — accounts for the server-rendered first page. */
  startPage?: number;
  showLabel?: boolean;
}

/**
 * "Load More" for the adaptive feed. Fetches the next ranked page from
 * /api/posts?personalized=true and appends cards, skipping any already shown
 * on the server-rendered first page. New cards carry `data-feed-post` so the
 * FeedFeedbackTracker keeps logging impressions/clicks for them.
 */
export function LoadMoreFeed({
  initialIds,
  startPage = 2,
  showLabel = true,
}: LoadMoreFeedProps) {
  const [posts, setPosts] = useState<LoadedPost[]>([]);
  const [page, setPage] = useState(startPage);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const seenRef = useRef(new Set(initialIds));
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/posts?page=${page}&limit=10&personalized=true`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const incoming: LoadedPost[] = Array.isArray(data.posts) ? data.posts : [];
      const fresh = incoming.filter((p) => !seenRef.current.has(p.id));
      for (const p of fresh) seenRef.current.add(p.id);
      setPosts((prev) => [...prev, ...fresh]);
      const totalPages = data.pagination?.totalPages ?? page;
      setHasMore(page < totalPages && fresh.length > 0);
      setPage((p) => p + 1);
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [page, loading]);

  // Infinite scroll: auto-load the next page when the sentinel scrolls into
  // view, with a short cool-down so rapid scrolling doesn't stack requests.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "600px 0px" }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, page, loadMore]);

  if (posts.length === 0 && !hasMore) return null;

  return (
    <>
      {posts.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-5">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/article/${post.slug}`}
              data-feed-post={post.id}
              className="group relative rounded-2xl bg-surface-900/60 border border-surface-800/50 overflow-hidden transition-all duration-300 hover:border-brand-500/30 hover:shadow-glow block"
            >
              <div className="relative h-40 md:h-48 bg-gradient-to-br from-surface-800 to-surface-900 overflow-hidden">
                {post.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.coverImage}
                    alt={post.title}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : null}
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
                <div className="absolute top-4 left-4">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/20 px-3 py-1 text-xs font-medium text-brand-400 border border-brand-500/20 backdrop-blur-sm">
                    {post.category?.name ?? "Uncategorized"}
                  </span>
                </div>
              </div>
              <div className="p-5">
                <h3 className="font-semibold text-surface-50 leading-snug mb-2 group-hover:text-brand-400 transition-colors line-clamp-2 text-base">
                  {post.title}
                </h3>
                <p className="text-surface-400 text-sm leading-relaxed mb-4 line-clamp-2">
                  {post.excerpt ?? post.title}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-accent-cyan flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0">
                      {post.author.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={post.author.avatar}
                          alt={post.author.name ?? post.author.username}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        (post.author.name ?? post.author.username)
                          .charAt(0)
                          .toUpperCase()
                      )}
                    </div>
                    <p className="text-xs font-medium text-surface-300 truncate">
                      {post.author.name ?? post.author.username}
                    </p>
                    <span className="text-[10px] text-surface-500">
                      {estimateReadTime(post.title + " " + (post.excerpt ?? ""))} min
                    </span>
                  </div>
                  {post.sourceUrl && (
                    <a
                      href={post.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title={`Read the original${post.source ? ` on ${post.source}` : ""}`}
                      className="inline-flex items-center gap-1 rounded-full bg-surface-800/90 px-2 py-0.5 text-[10px] font-medium text-surface-400 ring-1 ring-surface-700/60 transition-colors hover:text-brand-400 hover:ring-brand-500/30"
                    >
                      <Newspaper className="h-2.5 w-2.5" />
                      {post.source ? `via ${post.source}` : "via source"}
                    </a>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center mt-8 scroll-mt-24">
          <button
            onClick={loadMore}
            disabled={loading}
            className={cn(
              "group inline-flex items-center gap-2 rounded-xl border border-surface-700 px-8 py-3 text-sm font-medium transition-all",
              "text-surface-300 hover:bg-surface-800/50 hover:border-brand-500/30 hover:text-brand-400",
              loading && "opacity-60 cursor-not-allowed"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Auto-loading more stories…
              </>
            ) : (
              <>
                <InfinityIcon className="w-4 h-4 text-accent-strong" />
                {showLabel ? "Load More Stories" : "Load More"}
                <ChevronRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
          <span className="sr-only">More stories load automatically as you scroll.</span>
        </div>
      )}
    </>
  );
}