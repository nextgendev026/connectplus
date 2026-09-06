import { NextRequest, NextResponse } from "next/server";
import { pollFeeds } from "@/lib/rss-poll";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Cron endpoint not configured" }, { status: 503 });
  }

  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided || !timingSafeEqual(provided, secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const feedId = request.nextUrl.searchParams.get("feedId") ?? undefined;
    const summary = await pollFeeds(feedId);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("RSS cron poll error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}