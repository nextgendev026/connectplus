"use client";

import Link from "next/link";
import { ArrowRight, Bookmark, Clock, Heart, MessageCircle, PenLine, SearchX, Sparkles } from "lucide-react";
import OptimizedImage from "@/components/ui/OptimizedImage";
import { ViewCount } from "@/components/ui/ViewCount";
import { avatarSrc } from "@/lib/image-src";
import { coverSrc } from "@/lib/thumb";
import { formatCompact } from "@/lib/format-views";
import { cn, estimateReadTime, timeAgo } from "@/lib/utils";

/**
 * The pieces a feed card is built from.
 *
 * These were rendered by the home page's own server component. They live here
 * now because the feed is chosen in the browser: the category from the URL and
 * the signed-in reader's ranked order are both facts only the client has, and
 * a card that cannot be re-rendered cannot reflect them. Nothing here holds
 * state — it is the same markup, relocated, so the server can still render the
 * whole feed into the HTML.
 */

export interface FeedPost {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImage: string | null;
  viewCount: number;
  /** Only the home page's pool selects this; the ranked feed API does not. */
  featured?: boolean;
  createdAt: Date | string;
  author: { name: string | null; username: string; avatar: string | null };
  category: { name: string; slug: string } | null;
  tags: { id: string; name: string; slug: string }[];
  _count: { comments: number; likes: number };
}

export interface FeedCategory {
  id: string;
  name: string;
  slug: string;
  count: number;
}

export function AnimatedCard({
  children,
  index,
}: {
  children: React.ReactNode;
  index: number;
}) {
  return (
    <div
      className="stagger-card opacity-0 translate-y-4"
      style={{ transitionDelay: `${index * 80}ms` }}
    >
      {children}
    </div>
  );
}

export function PostCard({
  post,
  featured = false,
  index = 0,
}: {
  post: FeedPost;
  featured?: boolean;
  index?: number;
}) {
  return (
    <AnimatedCard index={index}>
      <Link
        href={`/article/${post.slug}`}
        data-feed-post={post.id}
        className={cn(
          "group relative rounded-2xl bg-surface-900/60 border border-surface-800/50 overflow-hidden transition-all duration-300 hover:border-brand-500/30 hover:shadow-glow block",
          featured ? "md:col-span-2" : ""
        )}
      >
        <div
          className={cn(
            "relative bg-gradient-to-br from-surface-800 to-surface-900 overflow-hidden",
            featured ? "h-56 md:h-72" : "h-40 md:h-48"
          )}
        >
          <OptimizedImage
            src={coverSrc(post.coverImage, {
              title: post.title,
              category: post.category?.name,
              seed: post.slug,
            })}
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
          <span className="absolute top-4 right-4 p-2 rounded-full bg-black/40 backdrop-blur-sm text-surface-400 opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100 transition-all">
            <Bookmark className="w-4 h-4" />
          </span>
          {featured && (
            <div className="absolute bottom-4 left-4 right-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/30 px-3 py-1 text-[10px] font-bold text-brand-ink border border-brand-400/30 backdrop-blur-sm uppercase tracking-wider">
                <Sparkles className="w-3 h-3" />
                Featured
              </span>
            </div>
          )}
        </div>

        <div className="p-5">
          <h3
            className={cn(
              "font-semibold text-surface-50 leading-snug mb-2 group-hover:text-brand-400 transition-colors line-clamp-2",
              featured ? "text-lg md:text-xl" : "text-base"
            )}
          >
            {post.title}
          </h3>
          <p className="text-surface-400 text-sm leading-relaxed mb-4 line-clamp-2">
            {post.excerpt ?? post.title}
          </p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
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
              <div>
                <p className="text-xs font-medium text-surface-300">
                  {post.author.name ?? post.author.username}
                </p>
                <p className="text-[10px] text-surface-500">
                  {estimateReadTime(
                    post.title + " " + (post.excerpt ?? "")
                  )}{" "}
                  min read
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 text-surface-500 text-xs">
              <ViewCount value={post.viewCount} />
              <span className="flex items-center gap-1">
                <Heart className="w-3 h-3" />
                <span title={`${post._count.likes.toLocaleString()} likes`}>
                  {formatCompact(post._count.likes)}
                </span>
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {post._count.comments}
              </span>
            </div>
          </div>
        </div>
      </Link>
    </AnimatedCard>
  );
}

export function FeaturedStoryBanner({ post }: { post: FeedPost }) {
  return (
    <AnimatedCard index={0}>
      <Link
        href={`/article/${post.slug}`}
        data-feed-post={post.id}
        className="group relative block rounded-2xl overflow-hidden bg-gradient-to-br from-brand-500/10 via-surface-900 to-accent-cyan/5 border border-surface-800/50 hover:border-brand-500/30 transition-all duration-500 hover:shadow-glow-lg"
      >
        <div className="relative h-64 sm:h-80 md:h-96 overflow-hidden">
          <OptimizedImage
            src={coverSrc(post.coverImage, {
              title: post.title,
              category: post.category?.name,
              seed: post.slug,
            })}
            alt={post.title}
            fill
            preset="cover"
            priority
            className="transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/20 via-transparent to-accent-cyan/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
          <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-brand-500/5 to-transparent" />
          <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-gradient-to-tr from-accent-cyan/5 to-transparent" />

          <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-8 md:p-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/20 px-3 py-1 text-xs font-bold text-brand-400 border border-brand-500/20 backdrop-blur-sm">
                <Sparkles className="w-3 h-3" />
                Featured
              </span>
              {post.category && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-3 py-1 text-xs font-medium text-white/80 border border-white/20 backdrop-blur-sm">
                  {post.category.name}
                </span>
              )}
            </div>
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold text-white leading-tight mb-3 group-hover:text-brand-400 transition-colors drop-shadow-md">
              {post.title}
            </h2>
            <p className="text-white/80 text-sm sm:text-base leading-relaxed mb-6 line-clamp-2 max-w-2xl">
              {post.excerpt}
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
              <div className="flex items-center gap-3">
                <div className="relative w-10 h-10 rounded-full overflow-hidden">
                  <OptimizedImage
                    src={avatarSrc(post.author.avatar, post.author.name ?? post.author.username)}
                    alt={post.author.name ?? post.author.username}
                    fill
                    preset="avatar"
                    width={80}
                    height={80}
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {post.author.name ?? post.author.username}
                  </p>
                  <p className="text-xs text-white/70">{timeAgo(post.createdAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-white/70 text-xs">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {estimateReadTime(post.title + " " + (post.excerpt ?? ""))} min read
                </span>
                <ViewCount value={post.viewCount} size="md" className="gap-1.5" />
                <span className="flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5" />
                  {post._count.comments}
                </span>
              </div>
              <div className="sm:ml-auto">
                <span className="inline-flex items-center gap-2 rounded-xl bg-brand-500/10 border border-brand-500/20 px-4 py-2 text-xs font-semibold text-brand-400 group-hover:bg-brand-500 group-hover:text-white transition-all">
                  Read Story
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </Link>
    </AnimatedCard>
  );
}

export function EmptyState({ categoryFilter }: { categoryFilter?: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="relative w-24 h-24 mb-8">
        <div className="absolute inset-0 rounded-3xl bg-surface-800/60 border border-surface-700/50 rotate-6" />
        <div className="absolute inset-0 rounded-3xl bg-surface-800/60 border border-surface-700/50 -rotate-3" />
        <div className="absolute inset-0 rounded-3xl bg-surface-900 border border-surface-700/50 flex items-center justify-center">
          <SearchX className="w-10 h-10 text-surface-500" />
        </div>
      </div>
      <h3 className="text-xl font-semibold text-surface-50 mb-2">No stories yet</h3>
      <p className="text-sm text-surface-400 max-w-sm mb-8 leading-relaxed">
        {categoryFilter
          ? "No stories have been published in this category yet. Check back soon or explore other categories."
          : "Be the first to share your story with the East African community."}
      </p>
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Link
          href="/studio"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600 transition-all shadow-glow hover:scale-[1.02]"
        >
          <PenLine className="w-4 h-4" />
          Write a Story
        </Link>
        {categoryFilter && (
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-surface-700 px-6 py-3 text-sm font-medium text-surface-300 hover:bg-surface-800/50 transition-colors"
          >
            View All Stories
          </Link>
        )}
      </div>
    </div>
  );
}
