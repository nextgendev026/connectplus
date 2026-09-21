"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, Heart, Loader2, MessageCircle, Newspaper, Infinity as InfinityIcon } from "lucide-react";
import { cn, estimateReadTime } from "@/lib/utils";
import { coverSrc } from "@/lib/thumb";
import { ViewCount } from "@/components/ui/ViewCount";
import { avatarSrc } from "@/lib/image-src";
import OptimizedImage from "@/components/ui/OptimizedImage";

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

/** Compact 1.2K / 3.4M form, matching the server-rendered feed card. */
interface LoadMoreFeedProps {
  initialIds: string[];
  /** First API page to fetch — accounts for the server-rendered first page. */
  startPage?: number;
  showLabel?: boolean;
  /**
   * Fill in the rest of ONE category instead of the ranked feed.
   *
   * A category view is filtered in the browser from the cached pool, which only
   * ever holds the newest handful of stories, so the first page of that
   * category's own list is what completes it. Passing a category also drops
   * `personalized`, which the API cannot honour alongside a filter anyway — and
   * which would have left every category page uncacheable.
   */
  category?: string | null;
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
  category = null,
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
      const query = category
        ? `page=${page}&limit=10&category=${encodeURIComponent(category)}`
        : `page=${page}&limit=10&personalized=true`;
      const res = await fetch(`/api/posts?${query}`, {
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
  }, [page, loading, category]);

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
                <OptimizedImage
                  src={post.coverImage ?? coverSrc(null, { title: post.title, category: post.category?.name, seed: post.slug })}
                  alt={post.title}
                  fill
                  preset="cover"
                  className="transition-transform duration-700 group-hover:scale-105"
                />
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
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="relative w-7 h-7 rounded-full overflow-hidden shrink-0">
                      <OptimizedImage
                        src={avatarSrc(post.author.avatar, post.author.name ?? post.author.username)}
                        alt={post.author.name ?? post.author.username}
                        fill
                        preset="avatar"
                        width={56}
                        height={56}
                      />
                    </div>
                    <p className="text-xs font-medium text-surface-300 truncate">
                      {post.author.name ?? post.author.username}
                    </p>
                    <span className="text-[10px] text-surface-500">
                      {estimateReadTime(post.title + " " + (post.excerpt ?? ""))} min
                    </span>
                  </div>
                  {/* Same stats the server-rendered feed card shows. This card
                      used to carry the count in its payload and drop it, so the
                      feed's own cards stopped reading as a series. */}
                  <div className="flex shrink-0 items-center gap-2.5 text-[11px] text-surface-500">
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
                    <ViewCount value={post.viewCount} />
                    <span className="inline-flex items-center gap-1" title="Likes">
                      <Heart className="h-3 w-3" />
                      {post._count?.likes ?? 0}
                    </span>
                    <span className="inline-flex items-center gap-1" title="Comments">
                      <MessageCircle className="h-3 w-3" />
                      {post._count?.comments ?? 0}
                    </span>
                  </div>
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