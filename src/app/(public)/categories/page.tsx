import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid, BookOpen, Eye, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Categories | connectPlus",
  description: "Browse stories by category — technology, culture, business, lifestyle and more from East Africa.",
};

const CATEGORY_EMOJI: Record<string, string> = {
  technology: "💻",
  culture: "🎭",
  business: "💼",
  lifestyle: "🌿",
  sports: "⚽",
  music: "🎵",
  food: "🍛",
  travel: "✈️",
  opinion: "💬",
  education: "🎓",
  health: "🩺",
  politics: "🏛️",
};

const CATEGORY_GRADIENTS = [
  "from-brand-500/25 to-accent-cyan/10",
  "from-accent-violet/25 to-brand-700/10",
  "from-accent-amber/20 to-brand-600/15",
  "from-accent-cyan/25 to-brand-500/10",
  "from-brand-400/25 to-accent-violet/10",
  "from-accent-pink/20 to-brand-700/10",
  "from-brand-500/20 to-accent-amber/10",
  "from-accent-violet/20 to-accent-cyan/10",
];

function categoryGradient(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = slug.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CATEGORY_GRADIENTS[Math.abs(hash) % CATEGORY_GRADIENTS.length] ?? "";
}

function formatCount(count: number): string {
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export default async function CategoriesPage() {
  const categories = await prisma.category.findMany({
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      _count: { select: { posts: true } },
    },
    orderBy: { name: "asc" },
  });

  const topPosts = await prisma.post.findMany({
    where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
    select: {
      id: true,
      title: true,
      slug: true,
      viewCount: true,
      categoryId: true,
      author: { select: { name: true, username: true, avatar: true } },
    },
    orderBy: { viewCount: "desc" },
    take: 60,
  });

  const postByCategory = new Map<string, typeof topPosts>();
  for (const post of topPosts) {
    if (!post.categoryId) continue;
    const list = postByCategory.get(post.categoryId) ?? [];
    if (list.length < 3) list.push(post);
    postByCategory.set(post.categoryId, list);
  }

  const sorted = [...categories]
    .sort((a, b) => b._count.posts - a._count.posts)
    .map((cat) => ({ ...cat, emoji: CATEGORY_EMOJI[cat.slug] ?? "📄" }));
  const totalStories = categories.reduce((sum, c) => sum + c._count.posts, 0);

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh-gradient" />
        <div className="absolute top-[10%] right-[10%] w-64 h-64 bg-accent-violet/6 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-[15%] left-[5%] w-56 h-56 bg-brand-500/6 rounded-full blur-3xl animate-float-delayed" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-20">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 border border-brand-500/20 px-4 py-1.5 mb-6 animate-fade-in-up">
            <LayoutGrid className="w-3.5 h-3.5 text-brand-400" />
            <span className="text-xs font-medium text-brand-400">
              {sorted.length} categories · {formatCount(totalStories)} stories
            </span>
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-bold tracking-tight text-surface-50 mb-4 animate-fade-in-up animation-delay-100">
            Browse by category
          </h1>
          <p className="text-sm sm:text-lg text-surface-400 max-w-2xl animate-fade-in-up animation-delay-200">
            From Nairobi&apos;s startup scene to the tastes of Dar — find your next
            read across technology, culture, business, and beyond.
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-3xl bg-surface-800/60 border border-surface-700/50 flex items-center justify-center mb-6">
              <LayoutGrid className="w-8 h-8 text-surface-500" />
            </div>
            <h3 className="text-xl font-semibold text-surface-50 mb-2">
              No categories yet
            </h3>
            <p className="text-sm text-surface-400 max-w-sm mb-8">
              Categories appear here as stories get organized.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sorted.map((cat) => {
              const posts = postByCategory.get(cat.id) ?? [];
              return (
                <div
                  key={cat.id}
                  className="group relative flex flex-col overflow-hidden rounded-3xl border border-surface-800/60 bg-surface-900/50 p-5 transition-all duration-300 hover:-translate-y-1 hover:border-brand-500/30 hover:shadow-glow-lg"
                >
                  <div
                    className={cn(
                      "absolute inset-0 bg-gradient-to-br opacity-40 transition-opacity duration-300 group-hover:opacity-60",
                      categoryGradient(cat.slug)
                    )}
                  />
                  <div className="relative">
                    <div className="flex items-start justify-between mb-4">
                      <span
                        className="flex items-center justify-center w-12 h-12 rounded-2xl bg-surface-800/70 border border-surface-700/50 backdrop-blur-sm text-2xl"
                        aria-hidden
                      >
                        {cat.emoji}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-surface-800/70 border border-surface-700/50 px-2.5 py-1 text-[10px] font-medium text-surface-300 backdrop-blur-sm"
                      >
                        <BookOpen className="w-3 h-3" />
                        {formatCount(cat._count.posts)}
                      </span>
                    </div>

                    <h2 className="font-display text-lg font-bold text-surface-50 mb-1 group-hover:text-brand-400 transition-colors">
                      {cat.name}
                    </h2>
                    <p className="text-[11px] text-surface-500 mb-4">
                      {cat._count.posts === 1
                        ? "1 story"
                        : `${cat._count.posts} stories`}{" "}
                      · #{cat.slug}
                    </p>

                    {posts.length > 0 ? (
                      <div className="space-y-2 mb-4">
                        {posts.slice(0, 3).map((post) => (
                          <Link
                            key={post.id}
                            href={`/article/${post.slug}`}
                            className="block rounded-xl bg-surface-950/40 border border-surface-800/40 p-2.5 hover:bg-surface-900/60 transition-colors"
                          >
                            <span className="line-clamp-2 text-xs font-medium text-surface-300 group-hover:text-brand-400 transition-colors">
                              {post.title}
                            </span>
                            <span className="text-[10px] text-surface-500 mt-0.5 flex items-center gap-1">
                              <Eye className="w-3 h-3" />
                              {formatCount(post.viewCount)} views ·{" "}
                              {post.author.name ?? post.author.username}
                            </span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center rounded-xl bg-surface-950/40 border border-dashed border-surface-700/50 p-4 mb-4 text-xs text-surface-500">
                        No stories yet
                      </div>
                    )}

                    <Link
                      href={`/?category=${cat.slug}`}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors"
                    >
                      Explore category
                      <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}