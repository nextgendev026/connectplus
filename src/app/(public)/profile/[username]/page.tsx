import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin,
  Calendar,
  Eye,
  FileText,
  Settings,
  ChevronRight,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { cn, formatDate, timeAgo, estimateReadTime } from "@/lib/utils";

export default async function ProfilePage({
  params,
}: {
  params: { username: string };
}) {
  const user = await prisma.user.findUnique({
    where: { username: params.username },
    include: {
      _count: { select: { posts: true } },
    },
  });

  if (!user) notFound();

  const viewsAgg = await prisma.post.aggregate({
    where: { authorId: user.id, status: "PUBLISHED" },
    _sum: { viewCount: true },
  });

  const totalViews = viewsAgg._sum.viewCount ?? 0;

  const posts = await prisma.post.findMany({
    where: { authorId: user.id, status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    include: {
      category: { select: { id: true, name: true, slug: true } },
      tags: { select: { id: true, name: true, slug: true } },
      _count: { select: { comments: true, likes: true } },
    },
  });

  const tabs = ["Posts", "About", "Statistics"] as const;

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Cover */}
      <div className="h-48 bg-gradient-to-r from-brand-900/40 via-surface-900 to-accent-violet/20 sm:h-64">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-full items-end pb-4">
            <Link
              href="/"
              className="flex items-center gap-1 text-xs text-surface-400 hover:text-surface-50 transition-colors"
            >
              <ChevronRight className="h-3 w-3 rotate-180" /> Back to Feed
            </Link>
          </div>
        </div>
      </div>

      {/* Profile Header */}
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="-mt-16 flex flex-col sm:flex-row sm:items-end sm:gap-6">
          {user.avatar ? (
            <img
              src={user.avatar}
              alt={user.name ?? user.username}
              className="h-32 w-32 rounded-2xl border-4 border-surface-950 object-cover shadow-xl"
            />
          ) : (
            <div className="h-32 w-32 rounded-2xl bg-surface-800 border-4 border-surface-950 flex items-center justify-center text-4xl font-bold text-surface-50 shadow-xl">
              {(user.name ?? user.username).charAt(0).toUpperCase()}
            </div>
          )}
          <div className="mt-4 flex-1 sm:mt-0 sm:pb-2">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-surface-50">
                {user.name ?? user.username}
              </h1>
              {user.isVerified && (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-500 text-[10px] text-white">
                  ✓
                </span>
              )}
            </div>
            <p className="text-surface-400">@{user.username}</p>
          </div>
          <div className="mt-4 flex gap-2 sm:mt-0 sm:pb-2">
            <button className="rounded-lg bg-brand-500 px-6 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
              Follow
            </button>
            <button className="rounded-lg border border-surface-700 bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:text-surface-50 transition-colors">
              <Settings className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Bio & Stats */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div>
            {user.bio && (
              <p className="text-surface-300 leading-relaxed">{user.bio}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-surface-500">
              {user.node && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {user.node}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Joined {formatDate(user.createdAt)}
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {totalViews.toLocaleString()} total views
              </span>
            </div>
          </div>

          <div className="flex gap-6 text-center">
            <div>
              <p className="text-xl font-bold text-surface-50">
                {user.followersCount.toLocaleString()}
              </p>
              <p className="text-xs text-surface-500">Followers</p>
            </div>
            <div>
              <p className="text-xl font-bold text-surface-50">
                {user.followingCount.toLocaleString()}
              </p>
              <p className="text-xs text-surface-500">Following</p>
            </div>
            <div>
              <p className="text-xl font-bold text-surface-50">
                {user._count.posts}
              </p>
              <p className="text-xs text-surface-500">Posts</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-8 border-b border-surface-800">
          <div className="flex gap-1">
            {tabs.map((tab, i) => (
              <button
                key={tab}
                className={cn(
                  "px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
                  i === 0
                    ? "border-brand-500 text-brand-400"
                    : "border-transparent text-surface-500 hover:text-surface-50"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Posts Grid */}
        <div className="py-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/article/${post.slug}`}
              className="group rounded-2xl border border-surface-800 bg-surface-900/50 p-5 transition-all duration-300 hover:border-surface-700 hover:shadow-card-hover"
            >
              <h3 className="text-base font-bold text-surface-50 group-hover:text-brand-400 transition-colors">
                {post.title}
              </h3>
              {post.excerpt && (
                <p className="mt-2 text-sm text-surface-400 line-clamp-2">
                  {post.excerpt}
                </p>
              )}
              <div className="mt-4 flex items-center gap-3 text-xs text-surface-500">
                <span>{timeAgo(post.createdAt)}</span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  {post.viewCount.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {estimateReadTime(post.content)}m
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
