import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { cache } from "react";
import type { Prisma } from "@prisma/client";

import { Clock, Eye, MessageCircle, ChevronRight, ExternalLink, Newspaper } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatDate, estimateReadTime } from "@/lib/utils";
import { postCoverSrc } from "@/lib/thumb";
import { getSiteConfig } from "@/lib/settings";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { FollowButton } from "@/components/ui/FollowButton";
import { LikeButton } from "@/components/ui/LikeButton";
import { ArticleActions } from "@/components/ui/ArticleActions";
import { CommentsSection } from "@/components/ui/CommentsSection";
import { StyledContent } from "@/components/ui/StyledContent";

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

function stripText(content: string): string {
  return content
    .replace(/<[^>]+>/g, " ")
    .replace(/[#*_~`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateMetadata({ params }: ArticleParams): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);

  if (!post) {
    return { title: "Post not found" };
  }

  let cfg;
  try {
    cfg = await getSiteConfig();
  } catch {
    cfg = null;
  }
  const baseUrl = cfg?.siteUrl ?? process.env.AUTH_URL ?? "https://connectplusapp.vercel.app";
  const canonical = `${baseUrl.replace(/\/$/, "")}/article/${post.slug}`;

  const description =
    (post.excerpt ?? "").trim() || stripText(post.title) || "Read this story on connectPlus.";
  // Social crawlers must be able to FETCH the preview image. A stored base64
  // data URI (several covers are 2–4 MB) produced og:image="https://site/data:…",
  // which every platform rejects — that is why shared links arrived bare.
  const imageUrl = `${baseUrl.replace(/\/$/, "")}${postCoverSrc(post.id)}`;

  return {
    title: post.title,
    description,
    alternates: { canonical },
    openGraph: {
      title: post.title,
      description,
      type: "article",
      url: canonical,
      siteName: cfg?.siteName ?? "connectPlus",
      publishedTime: post.publishedAt?.toISOString(),
      authors: [post.author.name ?? `@${post.author.username}`],
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
  const session = await auth();
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

  const [viewerIsFollowing] = await Promise.all([
    session?.user?.id
      ? prisma.follow
          .findUnique({
            where: {
              followerId_followingId: {
                followerId: session.user.id,
                followingId: post.authorId,
              },
            },
            select: { id: true },
          })
          .then(Boolean)
      : Promise.resolve(false),
  ]);

  // increment view count
  await prisma.post.update({
    where: { id: post.id },
    data: { viewCount: { increment: 1 } },
  });

  const viewCount = post.viewCount + 1;
  const readTime = estimateReadTime(post.content);
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

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: cover,
    datePublished: post.publishedAt?.toISOString() ?? post.createdAt.toISOString(),
    dateModified: post.updatedAt.toISOString(),
    author: {
      "@type": "Person",
      name: post.author.name ?? `@${post.author.username}`,
      url: `${siteConfig?.siteUrl ?? "https://connectplusapp.vercel.app"}/profile/${post.author.username}`,
    },
    publisher: {
      "@type": "Organization",
      name: siteConfig?.siteName ?? "connectPlus",
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": `${siteConfig?.siteUrl ?? "https://connectplusapp.vercel.app"}/article/${post.slug}`,
    },
    ...(post.category ? { articleSection: post.category.name } : {}),
    keywords: post.tags.map((t) => t.name).join(", "),
    ...(post.sourceUrl ? { isBasedOn: post.sourceUrl } : {}),
  };

  return (
    <div className="min-h-screen bg-surface-950">
      {/* JSON-LD structured data for search engines */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Hero */}
      <div className="relative h-[46vh] min-h-[360px] overflow-hidden">
        <Image
          src={cover}
          alt={post.title}
          fill
          className="object-cover"
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
              <div className="h-10 w-10 rounded-full bg-white/20 backdrop-blur-sm border border-white/20 overflow-hidden flex items-center justify-center text-sm font-bold text-white">
                {post.author.avatar ? (
                  <Image src={post.author.avatar} alt={post.author.name ?? ""} width={40} height={40} className="w-full h-full object-cover" />
                ) : (
                  post.author.name?.charAt(0) ?? "?"
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-white">{post.author.name ?? "Anonymous"}</p>
                <p className="text-xs text-white/60">@{post.author.username}</p>
              </div>
            </Link>
            <div className="flex items-center gap-4 text-xs text-white/70">
              <span>{publishedDate}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{readTime} min read</span>
              <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{viewCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Article Content */}
      <div className="mx-auto max-w-4xl min-w-0 px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid min-w-0 grid-cols-1 gap-12 lg:grid-cols-[1fr_280px]">
          <article className="min-w-0">
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

            <StyledContent content={post.content} />

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
                    description={post.excerpt ?? undefined}
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
                    initialFollowing={viewerIsFollowing}
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