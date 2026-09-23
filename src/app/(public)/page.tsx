import Link from "next/link";
import OptimizedImage from "@/components/ui/OptimizedImage";
import { avatarSrc } from "@/lib/image-src";
import nextDynamic from "next/dynamic";
import { prisma } from "@/lib/prisma";
import { postCoverSrc } from "@/lib/thumb";
import AdSlot from "@/components/ads/AdSlot";
import { cacheGet, cacheSet } from "@/lib/redis";
import { convexViewCounts, mergeLiveViewCounts } from "@/lib/convex";
import { ArrowRight, Pen, Users } from "lucide-react";
import { FeedCategoryProvider } from "@/components/feed/FeedFilter";
import { CategoryCarousel } from "@/components/feed/CategoryCarousel";
import { HomeFeed } from "@/components/feed/HomeFeed";
import type { FeedCategory, FeedPost } from "@/components/feed/FeedCards";

/**
 * Cached at the edge, and revalidated behind it.
 *
 * This page was `force-dynamic` for two reasons, and both have moved to the
 * browser. It read `?category=` to filter the pool, and `auth()` to rank the
 * feed for the signed-in reader — and reading either one makes a route render
 * per request. The category now comes from the URL on the client
 * (`FeedCategoryProvider`) and the ranked order is swapped in after hydration
 * (`HomeFeed`), so what is left is the same for everyone and can be shared.
 *
 * The Redis pool below still does its job: it is what makes the revalidation
 * render cheap rather than three heavy queries against a shared free-tier
 * Postgres.
 */
export const revalidate = 60;

// NOTE: no `ssr: false` — that option is illegal in Server Components.
// Plain next/dynamic still code-splits each chunk so the first paint ships
// less JavaScript; the components hydrate on the client as before.
const FeedLiveRefresh = nextDynamic(
  () => import("@/components/feed/FeedLiveRefresh").then((m) => m.FeedLiveRefresh)
);
const TrendingTopics = nextDynamic(
  () => import("@/components/feed/TrendingTopics").then((m) => m.TrendingTopics)
);
const ListeningLocation = nextDynamic(
  () => import("@/components/feed/ListeningLocation").then((m) => m.ListeningLocation)
);
const HeroSlideshow = nextDynamic(
  () => import("@/components/feed/HeroSlideshow").then((m) => m.HeroSlideshow)
);

/** Feed-pool data layer. The pool (posts + hero + categories + creators) is
 * user-independent — personalization is applied afterwards — so it is safe to
 * share across visitors.
 *
 * Three tiers, cheapest first:
 *   1. Redis pool snapshot (stale-while-revalidate, 60s freshness) — the heavy
 *      queries below take 15-25s against a shared free-tier Postgres, so
 *      serving them from Redis keeps the home page fast AND keeps the DB from
 *      being hammered on every render. `feed:version` (bumped on publish)
 *      invalidates instantly.
 *   2. Live DB fetch, which refreshes the snapshot at every tier.
 *   3. 24h Redis emergency snapshot + an in-process last-known-good mirror, so
 *      the page still renders when the DB (or both DB and Redis) is down.
 */
// Versioned with the pool shape below — a snapshot written by an older deploy
// destructures into the wrong variables, so it must never be read back.
const FALLBACK_KEY = "feed:home:fallback:v2";
const FRESH_MS = 60_000;
const POOL_TTL_SECONDS = 60 * 60 * 6;
interface PoolSnapshot {
  at: number;
  value: unknown;
}
let memoryFeedCache: { at: number; value: unknown } | null = null;

const DATE_KEYS = ["createdAt", "updatedAt", "publishedAt", "scheduledAt", "moderatedAt"];

/** Redis stores the snapshot as JSON, so Dates come back as ISO strings — but
 *  the feed components (HeroSlideshow, rankers) call Date methods on them.
 *  Revive the known timestamp fields when serving a cached snapshot. */
function reviveFeedDates<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => reviveFeedDates(item)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, raw] of Object.entries(out)) {
      if (typeof raw === "string" && DATE_KEYS.includes(key)) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) out[key] = parsed;
      } else if (raw && typeof raw === "object") {
        out[key] = reviveFeedDates(raw);
      }
    }
    return out as unknown as T;
  }
  return value;
}

async function fetchFeedPool<T extends unknown[]>(
  pages: { [K in keyof T]: Promise<T[K]> },
  key: string
): Promise<T> {
  const result = await Promise.all(pages);
  const snapshot: PoolSnapshot = { at: Date.now(), value: result };
  memoryFeedCache = snapshot;
  // AWAIT these on the cold path. Fire-and-forget writes are dropped when a
  // serverless invocation freezes after the response, which left every Vercel
  // request re-running the heavy queries (10s+ home page) while local dev
  // looked fine because the process stayed alive. Two small Redis writes are
  // ~20ms and they are the whole point of this cache.
  await Promise.all([
    cacheSet(key, snapshot, POOL_TTL_SECONDS).catch(() => {}),
    cacheSet(FALLBACK_KEY, result, 60 * 60 * 24).catch(() => {}),
  ]);
  return result;
}

async function withFeedFallback<T extends unknown[]>(
  pages: { [K in keyof T]: Promise<T[K]> },
  scope: string
): Promise<T> {
  let key = scope;
  try {
    const version = (await cacheGet<number>("feed:version").catch(() => null)) ?? 0;
    key = `${scope}:v${version}`;
    const snapshot = await cacheGet<PoolSnapshot>(key).catch(() => null);
    if (snapshot) {
      // Fresh enough — serve the snapshot.
      if (Date.now() - snapshot.at < FRESH_MS) return reviveFeedDates(snapshot.value as T);
      // Stale: serve immediately and revalidate in the background so a slow
      // query can never block a visitor (and the DB isn't hit per request).
      void fetchFeedPool(pages, key).catch(() => {});
      return reviveFeedDates(snapshot.value as T);
    }
  } catch {
    // fall through to a live fetch
  }

  try {
    return await fetchFeedPool(pages, key);
  } catch (err) {
    const cached = await cacheGet<T>(FALLBACK_KEY).catch(() => null);
    if (cached !== null) return reviveFeedDates(cached);
    if (memoryFeedCache) return reviveFeedDates(memoryFeedCache.value as T);

    // Last resort: render the page with nothing in the pools rather than
    // throwing.
    //
    // Every layer above this one has to fail at once to reach here — no Redis
    // snapshot, no 24-hour fallback copy, no process memory, and a database that
    // did not answer. The old code rethrew, which turned a database hiccup into
    // a 500 on the platform's most important URL, and turned a build with no
    // database into a failed deploy: `next build` prerenders `/`, every Prisma
    // call in the pool failed, and the whole build exited non-zero even though
    // every other route had compiled.
    //
    // A homepage whose feed is empty is degraded and visibly so; a homepage that
    // returns an error page is broken. The log line is what makes the difference
    // reportable — silence here is exactly the failure mode the platform's own
    // health modules exist to end.
    //
    // The cast is the cost of the pool's shape being generic: the caller asked
    // for `[posts, heroes, categories, creators]` and is given an empty version
    // of the same tuple, which every consumer below already handles.
    console.error(
      `[home] feed pools unavailable — rendering degraded (${scope}):`,
      err instanceof Error ? err.message : String(err)
    );
    return pages.map(() => []) as unknown as T;
  }
}

interface CategoryData {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
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

        {/* Sponsored slot — only renders when a campaign is live */}
        <AdSlot slot="feed-sidebar" />

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
                  <div className="relative w-9 h-9 rounded-full shrink-0 overflow-hidden">
                    <OptimizedImage
                      src={avatarSrc(writer.avatar, writer.name ?? writer.username)}
                      alt={writer.name ?? writer.username}
                      fill
                      preset="avatar"
                      width={72}
                      height={72}
                    />
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

        {/* Footer Links — the real routes. These were five `href="#"` anchors,
            which looked like navigation and were not: every one of the pages
            exists, so the sidebar's footer was quietly sending readers nowhere. */}
        <div className="text-[10px] text-surface-600 space-y-1 px-1">
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {[
              { label: "About", href: "/about" },
              { label: "Help", href: "/help" },
              { label: "Terms", href: "/terms" },
              { label: "Privacy", href: "/privacy" },
              { label: "Guidelines", href: "/guidelines" },
            ].map(({ label, href }) => (
              <Link
                key={label}
                href={href}
                className="hover:text-surface-400 transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
          <p>&copy; 2026 connectPlus. Made in East Africa.</p>
        </div>
      </div>
    </aside>
  );
}

export default async function HomeFeedPage() {
  const where = {
    status: "PUBLISHED",
    moderationStatus: "APPROVED",
  };

  const [postRows, heroRows, allCategories, allCreators] = await withFeedFallback([
    prisma.post.findMany({
      where,
      // The stored cover can be a multi-megabyte base64 data URI; selecting it
      // here is what made feeds slow. /api/thumb/post/<id> serves it instead.
      omit: { coverImage: true },
      include: {
        author: { select: { name: true, username: true, avatar: true } },
        category: { select: { name: true, slug: true } },
        tags: { select: { id: true, name: true, slug: true } },
        _count: { select: { comments: true, likes: true } },
      },
      orderBy: { createdAt: "desc" },
      // Every category, because the filter now happens in the browser and a
      // category view can only show what the pool happened to carry.
      take: 30,
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
    // No tag query here. It existed to feed a `trendingTags` rail that nothing
    // renders any more (TrendingTopics fetches its own), so a whole `findMany`
    // with a per-row `_count` was being paid for on every feed render — from the
    // pool cache, and on every revalidation, against a shared free-tier Postgres.
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
    // The cache key carries the pool's SHAPE: dropping a query above reuses
    // nothing that a previous deploy wrote, because a stale snapshot destructured
    // into a shorter tuple silently shifts one element into the next slot's
    // variable (the tags array would have become the creator list).
  ], "feed:pool3:all");

  // Swap the (omitted) stored cover for the small, cacheable thumb URL. This
  // keeps 2–4 MB base64 rows out of the RSC payload entirely.
  const storedPosts = postRows.map((p) => ({ ...p, coverImage: postCoverSrc(p.id) }));
  const storedHero = heroRows.map((p) => ({ ...p, coverImage: postCoverSrc(p.id) }));

  // View counts, made live.
  //
  // `Post.viewCount` is fed by a nightly fold of Convex's view deltas, and this
  // pool is additionally served from Redis for up to six hours, so a card could
  // read a number that was two clocks out of date — and a syndicated story,
  // created with `viewCount: 0`, read none at all while its article page showed
  // thousands. The article page has always asked Convex for the live total; the
  // cards now do too, for exactly the stories on screen, in one round trip.
  const liveCounts = await convexViewCounts([
    ...storedPosts.map((p) => p.id),
    ...storedHero.map((p) => p.id),
  ]);
  // Rank on the live numbers, not the stored ones: engagement is a ranking
  // input, so ordering a feed by a stale count orders it by the wrong thing.
  const posts = mergeLiveViewCounts(storedPosts, liveCounts);
  const heroPostRows = mergeLiveViewCounts(storedHero, liveCounts);

  const categories = allCategories
    .sort((a, b) => b._count.posts - a._count.posts)
    .slice(0, 8);
  const popularCreators = allCreators
    .sort((a, b) => b._count.posts - a._count.posts)
    .slice(0, 5);

  const feedCategories: FeedCategory[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    count: c._count.posts,
  }));

  // The displayed page is always the top 20 of the pool, so "load more" slices
  // continue cleanly from where the server stopped. Ordering here is the
  // control arm (recency); a signed-in reader in a personalised arm gets their
  // order swapped in by `HomeFeed` once the page has hydrated.
  const top: FeedPost[] = posts.slice(0, 20);

  return (
    <div className="min-h-screen bg-surface-950 scroll-smooth">
      <FeedCategoryProvider>
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

        <CategoryCarousel categories={feedCategories} />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-10 md:py-12">
          <HomeFeed
            posts={top}
            categories={feedCategories}
            sidebar={<TrendingSidebar popularCreators={popularCreators} />}
            inlineAd={<AdSlot slot="feed-inline" className="md:col-span-2" />}
          >
            <AdSlot slot="feed-top" className="mb-5" />
            <AdSlot slot="global-anchor" label="Ad" />
          </HomeFeed>
        </div>
      </FeedCategoryProvider>

      <FeedLiveRefresh />
    </div>
  );
}
