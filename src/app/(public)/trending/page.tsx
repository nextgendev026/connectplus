import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import {
  TrendingUp,
  Eye,
  Heart,
  MessageCircle,
  Clock,
  Crown,
  ArrowRight,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn, estimateReadTime, timeAgo } from "@/lib/utils";
import { BentoGrid } from "@/components/blog/BentoGrid";
import type { PostWithAuthor } from "@/types";

export const metadata: Metadata = {
  title: "Trending | connectPlus",
  description: "The most-read and most-loved stories from across East Africa right now.",
};

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function engagementScore(post: PostWithAuthor): number {
  const views = post.viewCount;
  const likes = post._count?.likes ?? 0;
  const comments = post._count?.comments ?? 0;
  return views + likes * 5 + comments * 10;
}

const PODIUM_GRADIENTS = [
  "from-amber-400/20 via-brand-500/10 to-transparent",
  "from-surface-500/20 via-surface-600/10 to-transparent",
  "from-orange-400/15 via-brand-700/10 to-transparent",
];

export default async function TrendingPage() {
  const posts = (await prisma.post.findMany({
    where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      category: { select: { id: true, name: true, slug: true } },
      tags: { select: { id: true, name: true, slug: true } },
      _count: { select: { comments: true, likes: true } },
    },
    take: 50,
  })) as PostWithAuthor[];

  const ranked = posts.sort(
    (a, b) => engagementScore(b) - engagementScore(a)
  );
  const top3 = ranked.slice(0, 3);
  const rest = ranked.slice(3, 18);

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh-gradient" />
        <div className="absolute top-[8%] right-[12%] w-72 h-72 bg-brand-500/6 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-[10%] left-[8%] w-56 h-56 bg-accent-cyan/6 rounded-full blur-3xl animate-float-delayed" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-20">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 border border-brand-500/20 px-4 py-1.5 mb-6 animate-fade-in-up">
            <TrendingUp className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-xs font-medium text-brand-400">Live from East Africa</span>
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight text-surface-50 mb-4 animate-fade-in-up animation-delay-100">
            Trending now
          </h1>
          <p className="text-sm sm:text-lg text-surface-400 max-w-2xl animate-fade-in-up animation-delay-200">
            Ranked by real engagement across the region — the stories East
            Africa is reading, loving, and talking about right now.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        {ranked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-3xl bg-surface-800/60 border border-surface-700/50 flex items-center justify-center mb-6">
              <TrendingUp className="w-8 h-8 text-surface-500" />
            </div>
            <h3 className="text-xl font-semibold text-surface-50 mb-2">
              Nothing trending yet
            </h3>
            <p className="text-sm text-surface-400 max-w-sm mb-8">
              When stories start getting read and loved, they&apos;ll appear here.
            </p>
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600 transition-all shadow-glow hover:scale-[1.02]"
            >
              Start the trend
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
              {top3.map((post, i) => (
                <Link
                  key={post.id}
                  href={`/article/${post.slug}`}
                  className={cn(
                    "group relative overflow-hidden rounded-3xl border border-surface-800/60 bg-surface-900/50 p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-glow-lg",
                    i === 0 && "md:col-span-3"
                  )}
                >
                  {post.coverImage ? (
                    <Image
                      src={post.coverImage}
                      alt={post.title}
                      fill
                      className="object-cover opacity-30 transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : null}
                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-br opacity-70",
                      PODIUM_GRADIENTS[i]
                    )}
                  />
                  <div className="relative">
                    <div className="flex items-center justify-between mb-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
                          i === 0
                            ? "bg-amber-400/15 text-amber-400 border border-amber-400/30"
                            : "bg-brand-500/15 text-brand-400 border border-brand-500/20"
                        )}
                      >
                        {i === 0 && <Crown className="w-3 h-3" />}
                        {i === 0 ? "Top Story" : `#${i + 1}`}
                      </span>
                      {post.category && (
                        <span className="inline-flex rounded-full bg-surface-800/80 px-3 py-1 text-[10px] font-medium text-surface-300 border border-surface-700/50 backdrop-blur-sm">
                          {post.category.name}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-cyan flex items-center justify-center text-sm font-bold text-white overflow-hidden shrink-0">
                        {post.author.avatar ? (
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
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-surface-50 truncate">
                          {post.author.name ?? post.author.username}
                        </p>
                        <p className="text-xs text-surface-500">
                          {timeAgo(post.createdAt)}
                        </p>
                      </div>
                    </div>

                    <h2
                      className={cn(
                        "font-display font-bold text-surface-50 leading-tight group-hover:text-brand-400 transition-colors",
                        i === 0 ? "text-2xl md:text-3xl" : "text-lg"
                      )}
                    >
                      {post.title}
                    </h2>
                    <p className="text-sm text-surface-400 mt-2 line-clamp-2">
                      {post.excerpt ?? post.title}
                    </p>

                    <div
                      className={cn(
                        "flex items-center gap-4 text-xs text-surface-500 mt-5",
                        i === 0 && "flex-wrap"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <Eye className="w-3.5 h-3.5" />
                        {formatCount(post.viewCount)} views
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Heart className="w-3.5 h-3.5" />
                        {formatCount(post._count?.likes ?? 0)} loves
                      </span>
                      <span className="flex items-center gap-1.5">
                        <MessageCircle className="w-3.5 h-3.5" />
                        {post._count?.comments ?? 0} comments
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5" />
                        {estimateReadTime(post.content)} min
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            {rest.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-6">
                  <h2 className="font-display text-xl font-bold text-surface-50">
                    More stories moving up
                  </h2>
                  <span className="text-xs text-surface-500">
                    Ranked by engagement
                  </span>
                </div>
                <BentoGrid posts={rest} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}