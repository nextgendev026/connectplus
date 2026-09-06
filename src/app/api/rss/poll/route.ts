import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pollFeeds } from "@/lib/rss-poll";

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

    const body = await request.json().catch(() => ({}));
    const { feedId } = body as { feedId?: string };

    const summary = await pollFeeds(feedId);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("RSS poll error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}