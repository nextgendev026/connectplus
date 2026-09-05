import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const feeds = await prisma.rssFeed.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { articles: true } } },
    });

    return NextResponse.json({ feeds });
  } catch (error) {
    console.error("Error fetching RSS feeds:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { name, url, category, description } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
      normalizedUrl = "https://" + normalizedUrl;
    }

    try {
      new URL(normalizedUrl);
    } catch {
      return NextResponse.json({ error: "Invalid URL format" }, { status: 400 });
    }

    const existing = await prisma.rssFeed.findUnique({ where: { url: normalizedUrl } });
    if (existing) {
      return NextResponse.json({ error: "A feed with this URL already exists" }, { status: 409 });
    }

    const feed = await prisma.rssFeed.create({
      data: {
        name: name.trim().slice(0, 200),
        url: normalizedUrl,
        category: category?.trim().slice(0, 100) || null,
        description: description?.trim().slice(0, 500) || null,
        isActive: true,
      },
    });

    return NextResponse.json({ feed }, { status: 201 });
  } catch (error) {
    console.error("Error creating RSS feed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const body = await request.json();
    const { feedId, isActive } = body;

    if (!feedId || typeof feedId !== "string") {
      return NextResponse.json({ error: "feedId is required" }, { status: 400 });
    }

    const feed = await prisma.rssFeed.findUnique({ where: { id: feedId } });
    if (!feed) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    const updated = await prisma.rssFeed.update({
      where: { id: feedId },
      data: { isActive: typeof isActive === "boolean" ? isActive : feed.isActive },
    });

    return NextResponse.json({ feed: updated });
  } catch (error) {
    console.error("Error updating RSS feed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
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
    const feedId = searchParams.get("id");

    if (!feedId) {
      return NextResponse.json({ error: "Feed ID is required" }, { status: 400 });
    }

    const feed = await prisma.rssFeed.findUnique({ where: { id: feedId } });
    if (!feed) {
      return NextResponse.json({ error: "Feed not found" }, { status: 404 });
    }

    await prisma.rssFeed.delete({ where: { id: feedId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting RSS feed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
