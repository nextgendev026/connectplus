import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { cacheGet, cacheSet } from "@/lib/redis";
import { ProfileHeader } from "@/components/profile/ProfileHeader";
import { ProfileTabs } from "@/components/profile/ProfileTabs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const user = await prisma.user.findUnique({
    where: { username },
    select: {
      name: true,
      username: true,
      avatar: true,
      bio: true,
      node: true,
      isVerified: true,
      _count: { select: { posts: true } },
    },
  });
  if (!user) return {};
  const displayName = user.name ?? user.username;
  const description =
    user.bio || `${displayName} is a writer on connectPlus — stories from East Africa.`;
  return {
    title: `${displayName} (@${user.username}) — connectPlus`,
    description,
    openGraph: {
      title: `${displayName} on connectPlus`,
      description,
      url: `/profile/${user.username}`,
      type: "profile",
      ...(user.avatar ? { images: [{ url: user.avatar, width: 200, height: 200 }] } : {}),
      siteName: "connectPlus",
    },
    twitter: {
      card: "summary",
      title: `${displayName} on connectPlus`,
      description,
      ...(user.avatar ? { images: [user.avatar] } : {}),
    },
  };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const session = await auth();

  // Cache profile metadata for 5 minutes to reduce DB hits
  const profileCacheKey = `profile:${username}`;
  const cachedProfile = await cacheGet<{
    user: any;
    totalViews: number;
    totalLikes: number;
  }>(profileCacheKey);

  let user: any;
  let totalViews: number;
  let totalLikes: number;

  if (cachedProfile) {
    user = cachedProfile.user;
    totalViews = cachedProfile.totalViews;
    totalLikes = cachedProfile.totalLikes;
  } else {
    user = await prisma.user.findUnique({
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
    totalViews = viewsAgg._sum.viewCount ?? 0;

    const likesAgg = await prisma.like.aggregate({
      where: { post: { authorId: user.id, status: "PUBLISHED" } },
      _count: true,
    });
    totalLikes = likesAgg._count;

    await cacheSet(profileCacheKey, { user, totalViews, totalLikes }, 300);
  }

  const viewerFollow =
    session?.user?.id && session.user.id !== user.id
      ? await prisma.follow
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
      : false;

  const isOwn = session?.user?.id === user.id;

  return (
    <div className="min-h-screen bg-surface-950">
      <ProfileHeader
        user={user}
        totalViews={totalViews}
        totalLikes={totalLikes}
        viewerFollow={viewerFollow}
        isOwn={isOwn}
      />

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="relative mx-auto max-w-5xl px-4 sm:px-6 pb-20 pt-4 sm:pb-10 sm:pt-5">
        <ProfileTabs
          username={username}
          ownProfile={isOwn}
          stats={{ totalViews, totalLikes }}
          about={user.bio}
          displayName={user.name ?? user.username}
        />
      </div>
    </div>
  );
}
