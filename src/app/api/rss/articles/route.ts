import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const feedId = searchParams.get("feedId");
    const category = searchParams.get("category");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: { feedId?: string; feed?: { category?: string } } = {};

    if (feedId) {
      where.feedId = feedId;
    }

    if (category) {
      where.feed = { category };
    }

    const [articles, total] = await Promise.all([
      prisma.rssArticle.findMany({
        where,
        skip,
        take: limit,
        orderBy: { publishedAt: "desc" },
        include: {
          feed: {
            select: { id: true, name: true, category: true, icon: true },
          },
        },
      }),
      prisma.rssArticle.count({ where }),
    ]);

    return NextResponse.json({
      articles,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Error fetching RSS articles:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
