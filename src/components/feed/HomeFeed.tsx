"use client";

import { Fragment, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { getFeedRankVariant } from "@/lib/experiments";
import {
  EmptyState,
  FeaturedStoryBanner,
  PostCard,
  type FeedCategory,
  type FeedPost,
} from "./FeedCards";
import { useFeedCategory } from "./FeedFilter";
import { LoadMoreFeed } from "./LoadMoreFeed";
import { FeedFeedbackTracker } from "./FeedFeedbackTracker";

/**
 * The home feed, chosen in the browser.
 *
 * The page underneath it is served from the CDN, which is only possible if the
 * server render does not depend on the reader. Two things did, and both are
 * resolved here instead:
 *
 *  • **The category** — `?category=` is read by `FeedCategoryProvider` from the
 *    URL and filters the pool that was rendered into the HTML. The pool is the
 *    newest stories across every category, so the chips, the categories page and
 *    shared links all keep working; a rare category simply starts with the few
 *    cards it had in the pool and `LoadMoreFeed` fills the rest of it in from
 *    its own (cached) endpoint.
 *
 *  • **The ranked order** — `rankFeed` needs the reader's preference vector, so
 *    a shared page cannot carry a personal order. The server renders the
 *    control order (recency), and a signed-in reader whose experiment arm is
 *    personalised gets their order swapped in once, right after hydration. The
 *    swap is skipped when the order is identical, so control-arm readers — and
 *    every anonymous visitor — never see the grid move.
 *
 * Everything a crawler sees is still rendered on the server: `PostCard`,
 * `FeaturedStoryBanner` and `EmptyState` are ordinary components, so the feed
 * ships as HTML and this only adds behaviour to it.
 */
export function HomeFeed({
  posts: initialPosts,
  categories,
  sidebar,
  children,
  inlineAd,
}: {
  /** The ranked pool, top 20, with live view counts already merged in. */
  posts: FeedPost[];
  categories: FeedCategory[];
  sidebar: React.ReactNode;
  /** Rendered between the heading and the grid, where it always was. */
  children: React.ReactNode;
  /**
   * The in-grid leaderboard. Passed in rather than imported: `AdSlot` is a
   * server component, and an async component cannot be pulled into a client
   * one — but a server-rendered element can be handed across as a slot.
   */
  inlineAd: React.ReactNode;
}) {
  const { category } = useFeedCategory();
  const { data: session, status } = useSession();

  const [ranked, setRanked] = useState<FeedPost[]>(initialPosts);
  const [personalized, setPersonalized] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    fetch("/api/posts?personalized=true&page=1&limit=20", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data || !Array.isArray(data.posts) || data.posts.length === 0) return;
        const incoming = data.posts as FeedPost[];
        if (
          incoming.map((p) => p.id).join(",") ===
          initialPosts.map((p) => p.id).join(",")
        ) {
          return;
        }
        setRanked(incoming);
        setPersonalized(true);
      })
      .catch(() => {
        // The control order stays; a missed personalization is not an error.
      });
    return () => {
      active = false;
    };
  }, [status, initialPosts]);

  // The featured slot is an editorial choice, so it stays on the post the
  // server picked even when the reader's own order differs — a banner that
  // reorders under the reader is a worse banner.
  const bannerPost = category ? null : initialPosts.find((p) => p.featured) ?? initialPosts[0] ?? null;

  const gridPosts = category
    ? ranked.filter((p) => p.category?.slug === category)
    : ranked.filter((p) => p.id !== bannerPost?.id);

  const heading = category
    ? categories.find((c) => c.slug === category)?.name ?? "Stories"
    : "Latest Stories";
  const total = gridPosts.length + (bannerPost ? 1 : 0);

  return (
    <>
      {bannerPost && (
        <div className="mb-10">
          <FeaturedStoryBanner post={bannerPost} />
        </div>
      )}

      <div id="feed" className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-surface-50">{heading}</h2>
            <span className="text-xs text-surface-500">
              {total} {total === 1 ? "story" : "stories"}
              {category ? " in this category" : " from across East Africa"}
            </span>
          </div>

          {/* Above the fold on the feed. The anchor is fixed-position, so it
              sits at the bottom of the viewport wherever it is mounted — it is
              kept out of the studio and settings by simply not being placed
              there. */}
          {children}

          {ranked.length === 0 ? (
            <EmptyState categoryFilter={category} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {gridPosts.map((post, i) => (
                <Fragment key={post.id}>
                  <PostCard post={post} index={i + 1} />
                  {/* One leaderboard every few cards — renders only when a
                      campaign is live, otherwise it collapses to nothing. */}
                  {i === 1 ? inlineAd : null}
                </Fragment>
              ))}
            </div>
          )}

          {ranked.length > 0 && (
            // Remounted whenever the view changes, so a category switch or the
            // personalized swap starts its own page count and seen-set rather
            // than continuing the previous one's.
            <LoadMoreFeed
              key={`${category ?? "all"}:${personalized ? "ranked" : "control"}`}
              initialIds={ranked.map((p) => p.id)}
              // Measured against what has actually been shown: the pool for the
              // ranked feed (so page N never re-sends cards already on screen),
              // and the category's own list for a category view, which is what
              // fills in the stories the pool did not happen to carry.
              startPage={
                Math.floor((category ? gridPosts.length : ranked.length) / 10) + 1
              }
              category={category}
            />
          )}
        </div>

        {sidebar}
      </div>

      <FeedFeedbackTracker variant={getFeedRankVariant(session?.user?.id)} />
    </>
  );
}
