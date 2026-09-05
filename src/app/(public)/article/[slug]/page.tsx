import Link from "next/link";

import {
  Clock,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Send,
  Link2,
  Copy,
  Bookmark,
  ChevronRight,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { timeAgo, formatDate, estimateReadTime } from "@/lib/utils";

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await prisma.post.findUnique({
    where: { slug },
    include: {
      author: {
        include: { _count: { select: { posts: true } } },
      },
      category: true,
      tags: true,
      _count: { select: { comments: true, likes: true } },
      comments: {
        where: { parentId: null },
        include: {
          author: true,
          replies: {
            include: { author: true },
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

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

  // related posts
  const relatedPosts = await prisma.post.findMany({
    where: {
      categoryId: post.categoryId,
      id: { not: post.id },
      status: "PUBLISHED",
    },
    include: { author: true },
    take: 3,
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Hero */}
      <div className="relative h-[50vh] min-h-[400px] overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-900/50 via-surface-950 to-surface-950" />
        <div className="absolute inset-0 bg-mesh-gradient opacity-60" />
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-surface-950 to-transparent" />
        <div className="relative mx-auto flex h-full max-w-4xl flex-col justify-end px-4 pb-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-sm text-surface-400">
            <Link href="/" className="hover:text-surface-50 transition-colors">Home</Link>
            <ChevronRight className="h-3 w-3" />
            {post.category && (
              <Link href={`/categories/${post.category.slug}`} className="hover:text-surface-50 transition-colors">
                {post.category.name}
              </Link>
            )}
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight text-surface-50 sm:text-4xl lg:text-5xl">
            {post.title}
          </h1>
          <div className="mt-4 flex items-center gap-4">
            <Link href={`/profile/${post.author.username}`} className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-surface-700 flex items-center justify-center text-sm font-bold text-surface-50">
                {post.author.name?.charAt(0) ?? "?"}
              </div>
              <div>
                <p className="text-sm font-medium text-surface-50">{post.author.name ?? "Anonymous"}</p>
                <p className="text-xs text-surface-400">@{post.author.username}</p>
              </div>
            </Link>
            <div className="flex items-center gap-4 text-xs text-surface-500">
              <span>{publishedDate}</span>
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{readTime} min read</span>
              <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{viewCount.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Article Content */}
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1fr_280px]">
          <article>
            <div className="flex flex-wrap gap-2 mb-8">
              {post.tags.map((tag) => (
                <span key={tag.id} className="rounded-full bg-surface-800 px-3 py-1 text-xs text-surface-300 hover:bg-surface-700 transition-colors cursor-pointer">
                  #{tag.name}
                </span>
              ))}
            </div>

            <div className="prose prose-lg max-w-none">
              {post.content.split("\n\n").map((paragraph, i) => (
                <p key={i} className="text-surface-300 leading-relaxed mb-6 text-base">
                  {paragraph}
                </p>
              ))}
            </div>

            {/* Actions */}
            <div className="mt-12 flex items-center justify-between border-t border-surface-800 pt-6">
              <div className="flex items-center gap-4">
                <button className="flex items-center gap-2 rounded-full bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <Heart className="h-4 w-4" />
                  <span>{post._count.likes}</span>
                </button>
                <button className="flex items-center gap-2 rounded-full bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <MessageCircle className="h-4 w-4" />
                  <span>{post._count.comments}</span>
                </button>
                <button className="flex items-center gap-2 rounded-full bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <Bookmark className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <Send className="h-4 w-4" />
                </button>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <Link2 className="h-4 w-4" />
                </button>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <Share2 className="h-4 w-4" />
                </button>
                <button className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 hover:bg-surface-700 hover:text-surface-50 transition-colors">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Comments */}
            <div className="mt-12">
              <h3 className="text-lg font-bold text-surface-50 mb-6">Comments ({post.comments.length})</h3>
              <div className="mb-6">
                <CommentForm postId={post.id} />
              </div>
              <div className="space-y-6">
                {post.comments.map((comment) => (
                  <div key={comment.id} className="flex gap-3">
                    <div className="h-8 w-8 flex-shrink-0 rounded-full bg-surface-700 flex items-center justify-center text-xs font-bold text-surface-50">
                      {comment.author.name?.charAt(0) ?? "?"}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-surface-50">{comment.author.name ?? "Anonymous"}</span>
                        <span className="text-xs text-surface-500">@{comment.author.username}</span>
                        <span className="text-xs text-surface-600">{timeAgo(comment.createdAt)}</span>
                      </div>
                      <p className="mt-1 text-sm text-surface-300">{comment.content}</p>
                      <button className="mt-2 flex items-center gap-1 text-xs text-surface-500 hover:text-surface-50 transition-colors">
                        <Heart className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Replies */}
                    {comment.replies.length > 0 && (
                      <div className="mt-4 ml-8 space-y-4 border-l border-surface-800 pl-4">
                        {comment.replies.map((reply) => (
                          <div key={reply.id} className="flex gap-3">
                            <div className="h-6 w-6 flex-shrink-0 rounded-full bg-surface-700 flex items-center justify-center text-[10px] font-bold text-surface-50">
                              {reply.author.name?.charAt(0) ?? "?"}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-surface-50">{reply.author.name ?? "Anonymous"}</span>
                                <span className="text-xs text-surface-500">@{reply.author.username}</span>
                                <span className="text-xs text-surface-600">{timeAgo(reply.createdAt)}</span>
                              </div>
                              <p className="mt-1 text-sm text-surface-300">{reply.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
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
                <button className="mt-4 w-full rounded-lg bg-brand-500 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
                  Follow
                </button>
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

function CommentForm({ postId }: { postId: string }) {
  return (
    <form
      action={async (formData: FormData) => {
        "use server";
        const content = formData.get("content") as string;
        if (!content?.trim()) return;
        await prisma.comment.create({
          data: {
            content: content.trim(),
            authorId: "1",
            postId,
          },
        });
      }}
    >
      <textarea
        name="content"
        placeholder="Share your thoughts..."
        className="w-full rounded-xl border border-surface-700 bg-surface-800/50 p-4 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
        rows={3}
        required
      />
      <div className="mt-2 flex justify-end">
        <button
          type="submit"
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
        >
          Post Comment
        </button>
      </div>
    </form>
  );
}
