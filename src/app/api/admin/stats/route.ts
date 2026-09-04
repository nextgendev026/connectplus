import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const userRole = (session.user as any).role;
    if (userRole !== "ADMIN" && userRole !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 }
      );
    }

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const [
      totalUsers,
      totalPosts,
      totalComments,
      viewsAggregate,
      pendingModeration,
      usersThisWeek,
      postsThisWeek,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.post.count(),
      prisma.comment.count(),
      prisma.post.aggregate({ _sum: { viewCount: true } }),
      prisma.post.count({ where: { moderationStatus: "PENDING" } }),
      prisma.user.count({ where: { createdAt: { gte: oneWeekAgo } } }),
      prisma.post.count({ where: { createdAt: { gte: oneWeekAgo } } }),
    ]);

    const regionalData = await prisma.user.groupBy({
      by: ["node"],
      _count: { id: true },
      where: { node: { not: null } },
      orderBy: { _count: { id: "desc" } },
      take: 10,
    });

    const regionalBreakdown = await Promise.all(
      regionalData
        .filter((r) => r.node !== null)
        .map(async (region) => {
          const nodeUsers = await prisma.user.findMany({
            where: { node: region.node },
            select: { id: true },
          });
          const userIds = nodeUsers.map((u) => u.id);

          const [postCount, viewData] = await Promise.all([
            prisma.post.count({
              where: { authorId: { in: userIds } },
            }),
            prisma.post.aggregate({
              where: { authorId: { in: userIds } },
              _sum: { viewCount: true },
            }),
          ]);

          return {
            city: region.node!,
            users: region._count.id,
            posts: postCount,
            views: viewData._sum.viewCount || 0,
          };
        })
    );

    const stats = {
      totalUsers,
      totalPosts,
      totalComments,
      totalViews: viewsAggregate._sum.viewCount || 0,
      pendingModeration,
      usersThisWeek,
      postsThisWeek,
      activeNodes: regionalData.length,
      regionalBreakdown,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
