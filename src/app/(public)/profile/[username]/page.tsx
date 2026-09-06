import Link from "next/link";
import { notFound } from "next/navigation";
import {
  MapPin,
  Calendar,
  Eye,
  Settings,
  ChevronRight,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { formatDate } from "@/lib/utils";
import { FollowButton } from "@/components/ui/FollowButton";
import { ProfileTabs } from "@/components/profile/ProfileTabs";
import type { ProfileTabPost } from "@/components/profile/ProfileTabs";

function serializePosts(
  posts: {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    content: string;
    viewCount: number;
    createdAt: Date;
  }[]
): ProfileTabPost[] {
  return posts.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    excerpt: p.excerpt,
  }));
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const session = await auth();

  const user = await prisma.user.findUnique({
    where: { username },
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

  const likesAgg = await prisma.like.aggregate({
    where: { post: { authorId: user.id, status: "PUBLISHED" } },
    _count: true,
  });

  const totalLikes = likesAgg._count;

  const [posts, viewerFollow, bookmarkedPosts] = await Promise.all([
    prisma.post.findMany({
      where: { authorId: user.id, status: "PUBLISHED" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        content: true,
        viewCount: true,
        createdAt: true,
      },
    }),
    session?.user?.id && session.user.id !== user.id
      ? prisma.follow
          .findUnique({
            where: {
              followerId_followingId: {
                followerId: session.user.id,
                followingId: user.id,
              },
            },
            select: { id: true },
          })
          .then(Boolean)
      : Promise.resolve(false),
    session?.user?.id === user.id
      ? prisma.bookmark.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          include: {
            post: {
              select: {
                id: true,
                slug: true,
                title: true,
                excerpt: true,
                content: true,
                viewCount: true,
                createdAt: true,
                author: { select: { name: true, username: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const savedPosts: ProfileTabPost[] = bookmarkedPosts.map((b) => ({
    id: b.post.id,
    slug: b.post.slug,
    title: b.post.title,
    excerpt: b.post.excerpt,
    content: b.post.content,
    viewCount: b.post.viewCount,
    createdAt: b.post.createdAt.toISOString(),
    authorName: b.post.author.name ?? `@${b.post.author.username}`,
  }));

  return (
    <div className="min-h-screen bg-surface-950">
      {/* Cover */}
      <div className="relative h-48 overflow-hidden sm:h-64">
        {user.coverImage ? (
          <img
            src={user.coverImage}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-r from-brand-900/40 via-surface-900 to-accent-violet/20" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-950 to-transparent" />
        <div className="relative mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
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
            <FollowButton
              targetId={user.id}
              initialFollowing={viewerFollow}
              followersCount={user.followersCount}
            />
            {session?.user?.id === user.id && (
              <Link
                href="/settings"
                className="rounded-lg border border-surface-700 bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:text-surface-50 transition-colors flex items-center justify-center gap-2"
                aria-label="Settings"
              >
                <Settings className="h-4 w-4" />
              </Link>
            )}
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

        <ProfileTabs
          posts={serializePosts(posts)}
          savedPosts={savedPosts}
          ownProfile={session?.user?.id === user.id}
          stats={{ totalViews, totalLikes }}
          about={user.bio}
        />
      </div>
    </div>
  );
}