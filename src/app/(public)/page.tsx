import Link from "next/link";
import Image from "next/image";
import Script from "next/script";
import { prisma } from "@/lib/prisma";
import { cn, estimateReadTime, timeAgo } from "@/lib/utils";
import { coverSrc } from "@/lib/thumb";
import { auth } from "@/lib/auth";
import { rankFeed } from "@/lib/feed-ranker";
import { cacheGet, cacheSet } from "@/lib/redis";
import { FeedLiveRefresh } from "@/components/feed/FeedLiveRefresh";
import { TrendingTopics } from "@/components/feed/TrendingTopics";
import { ListeningLocation } from "@/components/feed/ListeningLocation";
import { FeedFeedbackTracker } from "@/components/feed/FeedFeedbackTracker";
import { LoadMoreFeed } from "@/components/feed/LoadMoreFeed";
import { HeroSlideshow } from "@/components/feed/HeroSlideshow";
import {
  Eye,
  Heart,
  MessageCircle,
  ArrowRight,
  Bookmark,
  Users,
  SearchX,
  Pen,
  Sparkles,
  Clock,
  PenLine,
} from "lucide-react";

function formatViews(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/** Serve the home feed from a 24h Redis snapshot when the database is
 * unreachable (network blip / pooler outage) instead of hard-erroring the
 * page. Fresh fetches continuously refresh the snapshot. An in-memory
 * last-known-good mirror is the final tier so the page still renders when
 * BOTH the database and Redis are unreachable from this process. */
const FALLBACK_KEY = "feed:home:fallback";
let memoryFeedCache: { at: number; value: unknown } | null = null;

async function withFeedFallback<T extends unknown[]>(
  pages: { [K in keyof T]: Promise<T[K]> }
): Promise<T> {
  try {
    const result = await Promise.all(pages);
    memoryFeedCache = { at: Date.now(), value: result };
    void cacheSet(FALLBACK_KEY, result, 60 * 60 * 24).catch(() => {});
    return result;
  } catch (err) {
    const cached = await cacheGet<T>(FALLBACK_KEY).catch(() => null);
    if (cached !== null) return cached;
    if (memoryFeedCache) return memoryFeedCache.value as T;
    throw err;
  }
}

interface CategoryData {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  _count: { posts: number };
}

interface PostData {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  coverImage: string | null;
  viewCount: number;
  featured: boolean;
  createdAt: Date;
  author: { name: string | null; username: string; avatar: string | null };
  category: { name: string; slug: string } | null;
  tags: { id: string; name: string; slug: string }[];
  _count: { comments: number; likes: number };
}

interface TagData {
  id: string;
  name: string;
  slug: string;
  _count: { posts: number };
}

interface CreatorData {
  id: string;
  name: string | null;
  username: string;
  avatar: string | null;
  role: string;
  node: string | null;
  _count: { posts: number };
}

const CATEGORY_EMOJI: Record<string, string> = {
  technology: "💻",
  culture: "🎭",
  business: "💼",
  lifestyle: "🌿",
  sports: "⚽",
  music: "🎵",
  food: "🍛",
  travel: "✈️",
};

function PostCard({
  post,
  featured = false,
  index = 0,
}: {
  post: PostData;
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
          <Image
            src={coverSrc(post.coverImage, {
              title: post.title,
              category: post.category?.name,
              seed: post.slug,
            })}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute top-4 left-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/20 px-3 py-1 text-xs font-medium text-brand-400 border border-brand-500/20 backdrop-blur-sm">
              {post.category?.name ?? "Uncategorized"}
            </span>
          </div>
          <button className="absolute top-4 right-4 p-2 rounded-full bg-black/40 backdrop-blur-sm text-surface-400 hover:text-brand-400 transition-all opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100">
            <Bookmark className="w-4 h-4" />
          </button>
          {featured && (
            <div className="absolute bottom-4 left-4 right-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/30 px-3 py-1 text-[10px] font-bold text-brand-300 border border-brand-400/30 backdrop-blur-sm uppercase tracking-wider">
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
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-500 to-accent-cyan flex items-center justify-center text-xs font-bold text-white overflow-hidden shrink-0">
                {post.author.avatar ? (
                  <Image
                    src={post.author.avatar}
                    alt={post.author.name ?? post.author.username}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  (post.author.name ?? post.author.username)
                    .charAt(0)
                    .toUpperCase()
                )}
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
              <span className="flex items-center gap-1">
                <Eye className="w-3 h-3" />
                {formatViews(post.viewCount)}
              </span>
              <span className="flex items-center gap-1">
                <Heart className="w-3 h-3" />
                {formatViews(post._count.likes)}
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

function CategoryCarousel({
  categories,
  categoryFilter,
}: {
  categories: CategoryData[];
  categoryFilter?: string;
}) {
  return (
    <section className="border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 py-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          <Link
            href="/"
            className={cn(
              "shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold transition-all duration-200",
              !categoryFilter
                ? "bg-brand-500 text-white shadow-glow"
                : "border border-surface-700/50 text-surface-400 hover:text-surface-50 hover:border-surface-500 hover:bg-surface-800/50"
            )}
          >
            All
          </Link>
          {categories.map((cat) => {
            const emoji = CATEGORY_EMOJI[cat.slug] ?? "📄";
            const isActive = categoryFilter === cat.slug;
            return (
              <Link
                key={cat.id}
                href={`/?category=${cat.slug}`}
                className={cn(
                  "shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium transition-all duration-200",
                  isActive
                    ? "bg-brand-500 text-white border border-brand-400/30 shadow-glow"
                    : "border border-surface-700/50 text-surface-400 hover:text-surface-50 hover:border-surface-500 hover:bg-surface-800/50"
                )}
              >
                <span className="text-sm">{emoji}</span>
                {cat.name}
                <span
                  className={cn(
                    "ml-0.5 text-[10px]",
                    isActive ? "text-brand-200" : "text-surface-600"
                  )}
                >
                  {cat._count.posts}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FeaturedStoryBanner({ post }: { post: PostData }) {
  return (
    <AnimatedCard index={0}>
      <Link
        href={`/article/${post.slug}`}
        data-feed-post={post.id}
        className="group relative block rounded-2xl overflow-hidden bg-gradient-to-br from-brand-500/10 via-surface-900 to-accent-cyan/5 border border-surface-800/50 hover:border-brand-500/30 transition-all duration-500 hover:shadow-glow-lg"
      >
        <div className="relative h-64 sm:h-80 md:h-96 overflow-hidden">
          <Image
            src={coverSrc(post.coverImage, {
              title: post.title,
              category: post.category?.name,
              seed: post.slug,
            })}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            priority
          />
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/20 via-transparent to-accent-cyan/10" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />

          {/* Decorative elements */}
          <div className="absolute top-0 right-0 w-1/3 h-full bg-gradient-to-l from-brand-500/5 to-transparent" />
          <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-gradient-to-tr from-accent-cyan/5 to-transparent" />

          {/* Content */}
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
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500 to-accent-cyan flex items-center justify-center text-sm font-bold text-white overflow-hidden">
                  {post.author.avatar ? (
                    <Image
                      src={post.author.avatar}
                      alt={post.author.name ?? post.author.username}
                      width={40}
                      height={40}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    (post.author.name ?? post.author.username)
                      .charAt(0)
                      .toUpperCase()
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {post.author.name ?? post.author.username}
                  </p>
                  <p className="text-xs text-white/70">
                    {timeAgo(post.createdAt)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-white/70 text-xs">
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {estimateReadTime(
                    post.title + " " + (post.excerpt ?? "")
                  )}{" "}
                  min read
                </span>
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  {formatViews(post.viewCount)}
                </span>
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

function EmptyState({ categoryFilter }: { categoryFilter?: string }) {
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

function TrendingSidebar({
  popularCreators,
}: {
  popularCreators: CreatorData[];
}) {
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 space-y-5">
        {/* Trending Topics — realtime, with thumbnails + refresh */}
        <TrendingTopics />

        {/* Popular Writers */}
        <div className="rounded-2xl bg-surface-900/60 border border-surface-800/50 p-5 hover:border-surface-700/50 transition-colors">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-accent-cyan" />
            <h3 className="text-sm font-semibold text-surface-50">Popular Writers</h3>
          </div>
          {popularCreators.length > 0 ? (
            <div className="space-y-3">
              {popularCreators.slice(0, 4).map((writer) => (
                <a
                  key={writer.id}
                  href={`/profile/${writer.username}`}
                  className="flex items-center gap-3 group"
                >
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-brand-500 to-accent-violet flex items-center justify-center text-xs font-bold text-white shrink-0 overflow-hidden">
                    {writer.avatar ? (
                      <Image
                        src={writer.avatar}
                        alt={writer.name ?? writer.username}
                        width={36}
                        height={36}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      (writer.name ?? writer.username)
                        .charAt(0)
                        .toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-surface-300 group-hover:text-brand-400 transition-colors truncate">
                      {writer.name ?? writer.username}
                    </p>
                    <p className="text-[10px] text-surface-500 truncate">
                      {writer.node ?? writer.role} &middot;{" "}
                      {writer._count.posts}{" "}
                      {writer._count.posts === 1 ? "story" : "stories"}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-xs text-surface-500">
              No writers yet. Be the first!
            </p>
          )}
        </div>

        {/* Share Your Story CTA */}
        <div className="rounded-2xl bg-gradient-to-br from-brand-500/10 to-brand-500/5 border border-brand-500/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Pen className="w-4 h-4 text-brand-400" />
            <h3 className="text-sm font-semibold text-surface-50">
              Share Your Story
            </h3>
          </div>
          <p className="text-xs text-surface-400 leading-relaxed mb-4">
            Join thousands of East African writers and share your perspective
            with the community.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-600 transition-all hover:scale-[1.02]"
          >
            Get Started
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {/* Footer Links */}
        <div className="text-[10px] text-surface-600 space-y-1 px-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {["About", "Help", "Terms", "Privacy", "Guidelines"].map(
              (link) => (
                <a
                  key={link}
                  href="#"
                  className="hover:text-surface-400 transition-colors"
                >
                  {link}
                </a>
              )
            )}
          </div>
          <p>&copy; 2026 connectPlus. Made in East Africa.</p>
        </div>
      </div>
    </aside>
  );
}

export default async function HomeFeedPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string }>;
}) {
  const params = await searchParams;
  const categoryFilter = params?.category;

  const where: Record<string, unknown> = {
    status: "PUBLISHED",
    moderationStatus: "APPROVED",
  };

  if (categoryFilter) {
    where.category = { slug: categoryFilter };
  }

  const [posts, heroPostRows, allCategories, allTags, allCreators] = await withFeedFallback([
    prisma.post.findMany({
      where,
      include: {
        author: { select: { name: true, username: true, avatar: true } },
        category: { select: { name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
      orderBy: { createdAt: "desc" },
      // Larger pool for the adaptive ranker; filtered views stay at page size.
      take: categoryFilter ? 20 : 200,
    }),
    prisma.post.findMany({
      where: {
        status: "PUBLISHED",
        moderationStatus: "APPROVED",
        coverImage: { not: null },
      },
      select: {
        id: true,
        title: true,
        slug: true,
        excerpt: true,
        coverImage: true,
        viewCount: true,
        createdAt: true,
        category: { select: { name: true, slug: true } },
        author: { select: { name: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    prisma.category.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        icon: true,
        _count: { select: { posts: true } },
      },
    }) as Promise<CategoryData[]>,
    prisma.tag.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        _count: { select: { posts: true } },
      },
    }) as Promise<TagData[]>,
    prisma.user.findMany({
      where: {
        posts: { some: { status: "PUBLISHED", moderationStatus: "APPROVED" } },
      },
      select: {
        id: true,
        name: true,
        username: true,
        avatar: true,
        role: true,
        node: true,
        _count: { select: { posts: true } },
      },
    }) as Promise<CreatorData[]>,
  ]);

  const categories = allCategories
    .sort((a, b) => b._count.posts - a._count.posts)
    .slice(0, 8);
  const trendingTags = allTags
    .sort((a, b) => b._count.posts - a._count.posts)
    .slice(0, 5);
  const popularCreators = allCreators
    .sort((a, b) => b._count.posts - a._count.posts)
    .slice(0, 5);

  // Phase 1: adaptive ranking (recency for anonymous users, personalized for
  // signed-in users per their A/B variant). The displayed page is always the
  // top 20 of the ranked pool so "load more" slices continue cleanly.
  const session = await auth();
  const { posts: ranked, variant } = await rankFeed(posts, session?.user?.id ?? null);
  const top = ranked.slice(0, 20);
  const featuredPost = top.find((p) => p.featured) ?? top[0];
  const feedPosts = top.filter((p) => p.id !== featuredPost?.id);
  const feedIds = top.map((p) => p.id);

  return (
    <div className="min-h-screen bg-surface-950 scroll-smooth">
      <div className="relative z-20 -mt-14 mb-2 flex justify-center px-4">
        <ListeningLocation />
      </div>

      <HeroSlideshow
        slides={heroPostRows}
        stats={{
          writers: allCreators.length,
          stories: posts.length,
          cities: new Set(allCreators.map((c) => c.node).filter(Boolean)).size,
        }}
      />

      <CategoryCarousel
        categories={categories}
        categoryFilter={categoryFilter}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-12">
        {featuredPost && !categoryFilter && (
          <div className="mb-10">
            <FeaturedStoryBanner post={featuredPost} />
          </div>
        )}

        <div id="feed" className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-surface-50">
                {categoryFilter
                  ? categories.find((c) => c.slug === categoryFilter)?.name ??
                    "Stories"
                  : "Latest Stories"}
              </h2>
              <span className="text-xs text-surface-500">
                {feedPosts.length + (featuredPost ? 1 : 0)}{" "}
                {feedPosts.length + (featuredPost ? 1 : 0) === 1 ? "story" : "stories"}
                {categoryFilter ? " in this category" : " from across East Africa"}
              </span>
            </div>

            {posts.length === 0 ? (
              <EmptyState categoryFilter={categoryFilter} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {feedPosts.map((post, i) => (
                  <PostCard key={post.id} post={post} index={i + 1} />
                ))}
              </div>
            )}

            {posts.length > 0 && (
              <LoadMoreFeed
                initialIds={feedIds}
                startPage={Math.floor(feedIds.length / 10) + 1}
              />
            )}
          </div>

          <TrendingSidebar popularCreators={popularCreators} />
        </div>
      </div>

      <StaggerObserverScript />

      <FeedFeedbackTracker variant={variant} />

      <FeedLiveRefresh />
    </div>
  );
}

function AnimatedCard({
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

function StaggerObserverScript() {
  return (
    <Script id="stagger-observer" strategy="afterInteractive">
      {`
        (function() {
          var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
              if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
              }
            });
          }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

          function observeCards() {
            document.querySelectorAll('.stagger-card:not(.is-visible)').forEach(function(card) {
              observer.observe(card);
            });
          }

          observeCards();

          var mo = new MutationObserver(observeCards);
          mo.observe(document.documentElement, { childList: true, subtree: true });
        })();
      `}
    </Script>
  );
}
