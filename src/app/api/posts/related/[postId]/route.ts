import { NextRequest, NextResponse } from "next/server";
import { relatedPosts } from "@/lib/neural-vector";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const { postId } = await params;
    if (!postId) return NextResponse.json({ error: "Missing postId" }, { status: 400 });

    const posts = await relatedPosts(postId, 4);
    return NextResponse.json({ posts }, { status: 200 });
  } catch (error) {
    console.error("Related posts error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}