import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import type { Prisma } from "@prisma/client";

import { Clock, MessageCircle, ChevronRight, ExternalLink, Newspaper } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatDate, estimateReadTime } from "@/lib/utils";
import { postCoverSrc } from "@/lib/thumb";
import { avatarSrc } from "@/lib/image-src";
import OptimizedImage from "@/components/ui/OptimizedImage";
import { getSiteConfig } from "@/lib/settings";
import { stripSourcePromo } from "@/lib/seo";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { FollowButton } from "@/components/ui/FollowButton";
import { LikeButton } from "@/components/ui/LikeButton";
import { ArticleActions } from "@/components/ui/ArticleActions";
import { CommentsSection } from "@/components/ui/CommentsSection";
import { StyledContent } from "@/components/ui/StyledContent";
import AdSlot from "@/components/ads/AdSlot";
import { splitForInlineAd } from "@/lib/article-body";
import { ArticleViews } from "@/components/ui/ArticleViews";

/**
 * Cached at the edge, and revalidated behind it.
 *
 * This page used to be `force-dynamic` for two reasons, and both have moved to
 * the client where they belonged. The view count is now reported by the
 * browser (`ArticleViews` → `POST /api/views`), so the server render no longer
 * writes — which is also why a crawler, a prefetch or a bfcache restore stops
 * being counted as a reader. The reader's own follow state is resolved by
 * `FollowButton` itself. What is left is the article, which is the same for
 * everyone, and this is the page every share link lands on: rendering it per
 * request meant paying a Vercel invocation, a Postgres query and a Convex call
 * for each of them.
 *
 * `revalidatePath` in `PUT /api/posts/[id]` invalidates it the moment an
 * editor saves, so a correction does not wait out this window.
 */
export const revalidate = 120;

/**
 * A slug that does not exist is not an article.
 *
 * Rendering a 200 "Post not found" page is a soft 404, and now that the result
 * is cached it would also be cached as one. `noindex` keeps a mistyped or
 * deleted slug out of the index without inventing a 404 page this app has not
 * designed.
 */
const MISSING_ROBOTS: Metadata["robots"] = { index: false, follow: true };

interface ArticleParams {
  params: Promise<{ slug: string }>;
}

const ARTICLE_INCLUDE = {
  author: {
    select: {
      id: true,
      name: true,
      username: true,
      avatar: true,
      bio: true,
      followersCount: true,
      _count: { select: { posts: true } },
    },
  },
  category: { select: { id: true, name: true, slug: true } },
  tags: { select: { id: true, name: true, slug: true } },
  _count: { select: { comments: true, likes: true } },
  comments: {
    where: { parentId: null },
    include: {
      author: { select: { id: true, name: true, username: true } },
      replies: {
        include: { author: { select: { id: true, name: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { createdAt: "desc" },
  },
} satisfies Prisma.PostInclude;

// React cache() dedupes the post lookup across generateMetadata and the page
// render, so a single article view pays one DB query for it instead of two.
// `omit` keeps the stored cover column (which can be a multi-megabyte base64
// data URI) out of the render payload; the cover is served by
// /api/thumb/post/<id> instead, which is also what og:image points at.
const getPost = cache((slug: string) =>
  prisma.post.findUnique({
    where: { slug },
    include: ARTICLE_INCLUDE,
    omit: { coverImage: true },
  })
);

/**
 * The newest stories, prerendered at build.
 *
 * This is not decoration: in the App Router a dynamic segment that is not
 * registered here is rendered on demand and, unlike a page, is **not** written
 * to the full route cache — so `revalidate` above would have been inert and
 * every article view would still have cost a render. Declaring the params makes
 * the route a cached one, where these twenty are built ahead of time and every
 * other slug is rendered on first request and then cached for `revalidate`.
 *
 * Kept short on purpose. These are the stories a share link lands on within
 * minutes of publishing; the long tail pays its own way by being rendered on
 * first request and cached. A longer list buys nothing and costs a lot: the
 * build runs against the same shared free-tier Postgres as everything else, in
 * parallel workers, and a bigger prerender list has already exhausted its
 * connection pool (P2024) and failed the build outright.
 *
 * A build with no database still has to succeed, so a failure here returns
 * nothing and leaves the route entirely to on-demand generation.
 */
export async function generateStaticParams() {
  try {
    const posts = await prisma.post.findMany({
      where: { status: "PUBLISHED", moderationStatus: "APPROVED" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { slug: true },
    });
    return posts.map((post) => ({ slug: post.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: ArticleParams): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    return { title: "Post not found", robots: MISSING_ROBOTS };
  }

  let cfg;
  try {
    cfg = await getSiteConfig();
  } catch {
    cfg = null;
  }
  const baseUrl = (cfg?.siteUrl ?? process.env.AUTH_URL ?? "https://connectplusapp.vercel.app").replace(/\/$/, "");
  const siteName = cfg?.siteName ?? "connectPlus";
  const canonical = `${baseUrl}/article/${post.slug}`;

  // Syndicated stories carry their origin's promo text — "… Read more at
  // https://publisher.co.ke/story". Stripped here, because this description is
  // what other platforms print on the card: our article details, never another
  // publisher's raw URL.
  const description =
    stripSourcePromo(post.excerpt) ||
    stripSourcePromo(post.content, 200) ||
    `Read "${post.title}" on ${siteName}.`;
  // Social crawlers must be able to FETCH the preview image. A stored base64
  // data URI (several covers are 2–4 MB) produced og:image="https://site/data:…",
  // which every platform rejects — that is why shared links arrived bare.
  const imageUrl = `${baseUrl}${postCoverSrc(post.id)}`;

  return {
    title: post.title,
    description,
    alternates: { canonical },
    // The article is the page that matters, so it asks to be indexed with a
    // full-size preview rather than having the thumbnail cropped by a default.
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, "max-image-preview": "large" },
    },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      url: canonical,
      siteName,
      publishedTime: post.publishedAt?.toISOString(),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.author.name ?? `@${post.author.username}`],
      ...(post.category ? { section: post.category.name } : {}),
      tags: post.tags.map((t) => t.name),
      images: [{ url: imageUrl, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ArticlePage({ params }: ArticleParams) {
  const { slug } = await params;
  const [siteConfig, post] = await Promise.all([
    getSiteConfig().catch(() => null),
    getPost(slug),
  ]);

  if (!post) {
    return (
      <div className="min-h-screen bg-surface-950 flex flex-col items-center justify-center text-center px-4">
        <h1 className="text-4xl font-bold text-surface-50 mb-4">Post not found</h1>
        <p className="text-surface-400 mb-6">The article you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/" className="rounded-lg bg-brand-500 px-6 py-3 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          Back to Home
        </Link>
      </div>
    );
  }

  // The view is counted by `ArticleViews` in the browser, from the number this
  // render was served with. Nothing about rendering this page writes.
  const readTime = estimateReadTime(post.content);
  // Contextual targeting: a campaign can name the category slug or its id, and
  // both are offered so an admin does not have to know which one we key on.
  const adCategories = [post.category?.slug ?? "", post.categoryId ?? ""].filter(Boolean);
  // Mid-content is the highest-viewability placement on the page, and it is only
  // placed when the body is long enough to carry it and has a safe block break.
  const bodySplit = splitForInlineAd(post.content);
  const publishedDate = post.publishedAt
    ? formatDate(post.publishedAt)
    : formatDate(post.createdAt);

  const isSyndicated = Boolean(post.sourceUrl || post.source);

  // related posts
  const relatedPosts = await prisma.post.findMany({
    where: {
      categoryId: post.categoryId,
      id: { not: post.id },
      status: "PUBLISHED",
    },
    include: { author: { select: { name: true } } },
    omit: { coverImage: true },
    take: 3,
    orderBy: { createdAt: "desc" },
  });

  const cover = postCoverSrc(post.id);

  const siteOrigin = (siteConfig?.siteUrl ?? "https://connectplusapp.vercel.app").replace(/\/$/, "");
  const canonicalUrl = `${siteOrigin}/article/${post.slug}`;
  // No `isBasedOn`: the origin URL belongs in the on-page credit, not in the
  // structured data that search engines and social platforms read the article
  // through.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: stripSourcePromo(post.excerpt) || undefined,
    // Absolute, and served by us — a relative path or the publisher's host is
    // not a usable image for a crawler.
    image: `${siteOrigin}${cover}`,
    url: canonicalUrl,
    datePublished: post.publishedAt?.toISOString() ?? post.createdAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: {
      "@type": "Person",
      name: post.author.name ?? `@${post.author.username}`,
      url: `${siteOrigin}/profile/${post.author.username}`,
    },
    publisher: {
      "@type": "Organization",
      name: siteConfig?.siteName ?? "connectPlus",
      logo: { "@type": "ImageObject", url: `${siteOrigin}/pwa-512.png` },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonicalUrl,
    },
    ...(post.category ? { articleSection: post.category.name } : {}),
    keywords: post.tags.map((t) => t.name).join(", "),
    isAccessibleForFree: true,
  };

  return (
    <div className="min-h-screen bg-surface-950">
      {/* JSON-LD structured data for search engines */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />

      {/* Hero */}
      <div className="relative h-[46vh] min-h-[360px] overflow-hidden">
        {/*
         * The hero goes through the same component as every other cover.
         *
         * It was a bare next/image, which sends the request to Vercel's
         * image optimizer — a separate meter from function invocations, and the
         * one that runs out. When it does, the endpoint answers 402 with an HTML
         * body instead of the picture, and since this is the *only* image on the
         * article page that took that path, the symptom was specific and odd:
         * every imported story's hero missing while the author avatar beside it
         * rendered fine.
         *
         * `cover` is a `/api/thumb/post/<id>` URL, which OptimizedImage hands to
         * our own route untouched — so this now costs no third-party service at
         * all, and falls back to the stored original if that route ever fails.
         */}
        <OptimizedImage
          src={cover}
          alt={post.title}
          preset="cover"
          fill
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900/50 via-black/80 to-black" />
        <div className="absolute inset-0 bg-mesh-gradient opacity-40" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black to-transparent" />
        <div className="relative mx-auto flex h-full max-w-4xl flex-col justify-end px-4 pb-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-white/70">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <ChevronRight className="h-3 w-3" />
            {post.category && (
              <Link href={`/categories/${post.category.slug}`} className="hover:text-white transition-colors">
                {post.category.name}
              </Link>
            )}
          </div>
          <h1 className="mt-3 break-words text-3xl font-bold leading-tight text-white sm:text-4xl lg:text-5xl drop-shadow-md">
            {post.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href={`/profile/${post.author.username}`} className="flex items-center gap-3">
              {/*
               * The author's own picture, resolved the way the rest of the app
               * resolves avatars.
               *
               * This was a bare next/image on the stored URL, which failed for
               * exactly the readers it mattered to: an avatar hosted somewhere
               * the image config does not allowlist renders as nothing, and a
               * reader with no avatar at all got a letter instead of a picture.
               * `avatarSrc` serves the real image when there is one and an
               * initials plate when there is not, and the optimizer shrinks it.
               */}
              <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/20 overflow-hidden flex items-center justify-center text-sm font-bold text-white">
                <OptimizedImage
                  src={avatarSrc(post.author.avatar, post.author.name)}
                  alt={post.author.name ?? post.author.username}
                  preset="avatar"
                  width={40}
                  height={40}
                  className="h-full w-full object-cover"
                />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{post.author.name ?? "Anonymous"}</p>
                <p className="text-xs text-white/60">@{post.author.username}</p>
              </div>
            </Link>
            <div className="flex items-center gap-4 text-xs text-white/70">
              <span>{publishedDate}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{readTime} min read</span>
              <ArticleViews postId={post.id} initialValue={post.viewCount} />
            </div>
          </div>
        </div>
      </div>

      {/* Article Content */}
      <div className="mx-auto max-w-4xl min-w-0 px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid min-w-0 grid-cols-1 gap-12 lg:grid-cols-[1fr_280px]">
          <article className="min-w-0">
            {/* Above-the-fold sponsor slot (renders only when a campaign is live) */}
            <AdSlot slot="article-top" className="mb-8" categories={adCategories} />

            <div className="flex flex-wrap gap-2 mb-8">
              {post.tags.map((tag) => (
                <span key={tag.id} className="rounded-full bg-surface-800 px-3 py-1 text-xs text-surface-300 hover:bg-surface-700 transition-colors cursor-pointer">
                  #{tag.name}
                </span>
              ))}
            </div>

            {/* Original source — syndicated RSS articles always credit their origin */}
            {isSyndicated && (
              <div className="mb-8 flex items-start gap-3 rounded-xl border border-brand-500/20 bg-gradient-to-r from-brand-500/10 to-accent-amber/5 px-4 py-3">
                <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                <p className="text-xs leading-relaxed text-surface-300">
                  {post.source ? (
                    <>
                      This story was originally published by{" "}
                      <strong className="text-surface-50">{post.source}</strong>.
                    </>
                  ) : (
                    <>This story was originally published on an external site.</>
                  )}{" "}
                  {post.sourceUrl && (
                    <a
                      href={post.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-brand-400 underline underline-offset-2 hover:text-brand-300 transition-colors"
                    >
                      Read the original
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </p>
              </div>
            )}

            {bodySplit ? (
              <>
                <StyledContent content={bodySplit.lead} />
                <AdSlot slot="article-inline" className="my-10" categories={adCategories} />
                <StyledContent content={bodySplit.rest} />
              </>
            ) : (
              <StyledContent content={post.content} />
            )}

            {/* End-of-story: the reader who finished the piece is the one most
                likely to actually see this one. */}
            <AdSlot slot="article-bottom" className="mt-10" categories={adCategories} />
            <AdSlot slot="global-anchor" label="Ad" categories={adCategories} />

            {/* Actions — wraps into two rows on phones instead of overflowing */}
            <div className="mt-12 border-t border-surface-800 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <LikeButton postId={post.id} initialCount={post._count.likes} />
                  <a
                    href="#comments"
                    className="flex items-center gap-2 rounded-full bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:bg-surface-700 hover:text-surface-50 transition-colors"
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span>{post._count.comments}</span>
                  </a>
                  <BookmarkButton postId={post.id} fetchState variant="pill" />
                </div>
                <div className="flex items-center gap-2">
                  <ArticleActions
                    url={`/article/${post.slug}`}
                    title={post.title}
                    description={stripSourcePromo(post.excerpt) || undefined}
                    image={cover}
                  />
                </div>
              </div>
            </div>

            {/* Mobile related stories (horizontal strip) */}
            {relatedPosts.length > 0 && (
              <div className="mt-12 lg:hidden">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-bold text-surface-50">
                  <span className="h-1 w-1 rounded-full bg-brand-400" />
                  Related Stories
                </h4>
                <div className="scrollbar-hide -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
                  {relatedPosts.map((rp) => (
                    <Link
                      key={rp.id}
                      href={`/article/${rp.slug}`}
                      className="group w-64 shrink-0 rounded-2xl border border-surface-800 bg-surface-900/50 p-4 transition-colors hover:border-brand-500/30"
                    >
                      <p className="text-sm font-medium leading-snug text-surface-300 group-hover:text-brand-400 transition-colors line-clamp-3">
                        {rp.title}
                      </p>
                      <p className="mt-2 text-xs text-surface-500">
                        {rp.author.name} · {estimateReadTime(rp.content)} min read
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Comments */}
            {siteConfig?.features.comments !== false && (
              <div id="comments">
                <CommentsSection postId={post.id} initialComments={post.comments} />
              </div>
            )}
          </article>

          {/* Sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 space-y-6">
              {/* Sponsored slot */}
              <AdSlot slot="article-sidebar" categories={adCategories} />
              <AdSlot slot="article-sticky" categories={adCategories} />

              {/* Author Card */}
              <div className="rounded-2xl border border-surface-800 bg-surface-900/50 p-5">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-surface-700 flex items-center justify-center text-lg font-bold text-surface-50">
                    {post.author.name?.charAt(0) ?? "?"}
                  </div>
                  <div>
                    <p className="font-medium text-surface-50">{post.author.name ?? "Anonymous"}</p>
                    <p className="text-xs text-surface-400">@{post.author.username}</p>
                  </div>
                </div>
                {post.author.bio && (
                  <p className="mt-3 text-sm text-surface-400 leading-relaxed">{post.author.bio}</p>
                )}
                <div className="mt-4 flex items-center gap-4 text-xs text-surface-500">
                  <span><strong className="text-surface-50">{post.author.followersCount.toLocaleString()}</strong> followers</span>
                  <span><strong className="text-surface-50">{post.author._count.posts}</strong> posts</span>
                </div>
                <div className="mt-4">
                  <FollowButton
                    targetId={post.authorId}
                    fetchState
                    followersCount={post.author.followersCount}
                    className="w-full"
                  />
                </div>
              </div>

              {/* Related Articles */}
              {relatedPosts.length > 0 && (
                <div className="rounded-2xl border border-surface-800 bg-surface-900/50 p-5">
                  <h4 className="text-sm font-bold text-surface-50 mb-4">Related Stories</h4>
                  <div className="space-y-4">
                    {relatedPosts.map((rp) => (
                      <Link key={rp.id} href={`/article/${rp.slug}`} className="group block">
                        <p className="text-sm font-medium text-surface-300 group-hover:text-surface-50 transition-colors leading-snug">
                          {rp.title}
                        </p>
                        <p className="mt-1 text-xs text-surface-500">
                          {rp.author.name} · {estimateReadTime(rp.content)} min read
                        </p>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}