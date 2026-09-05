import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ bookmarked: false });
    }
    const { postId } = await params;
    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: session.user.id, postId } },
      select: { id: true },
    });
    return NextResponse.json({ bookmarked: !!existing });
  } catch (error) {
    console.error("Error fetching bookmark status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { postId } = await params;
    const existing = await prisma.bookmark.findUnique({
      where: { userId_postId: { userId: session.user.id, postId } },
    });
    if (existing) {
      return NextResponse.json({ bookmarked: true });
    }
    await prisma.bookmark.create({ data: { userId: session.user.id, postId } });
    return NextResponse.json({ bookmarked: true }, { status: 201 });
  } catch (error) {
    console.error("Error bookmarking post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ postId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const { postId } = await params;
    await prisma.bookmark.deleteMany({
      where: { userId: session.user.id, postId },
    });
    return NextResponse.json({ bookmarked: false });
  } catch (error) {
    console.error("Error removing bookmark:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}