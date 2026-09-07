import { NextRequest, NextResponse } from "next/server";
import { triggerRssPoll } from "@/lib/inngest-trigger";

// Manual trigger endpoint for admin panel
// Body: { trigger: "rss-poll" } or { trigger: "rss-poll-feed", feedId: "feed_123" }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { trigger, feedId } = body;

    if (trigger === "rss-poll") {
      const result = await triggerRssPoll();

      if (result.mode === "direct") {
        return NextResponse.json({
          success: true,
          mode: "direct",
          message: `RSS poll completed: ${result.summary.newArticles} new articles from ${result.summary.feedsPolled} feeds`,
          summary: result.summary,
        });
      }

      return NextResponse.json({
        success: true,
        mode: "inngest",
        message: "RSS poll scheduled via Inngest - will run on next schedule",
      });
    }

    if (trigger === "rss-poll-feed" && feedId) {
      const result = await triggerRssPoll(feedId);

      if (result.mode === "direct") {
        return NextResponse.json({
          success: true,
          mode: "direct",
          message: `RSS feed ${feedId} poll completed`,
          summary: result.summary,
        });
      }

      return NextResponse.json({
        success: true,
        mode: "inngest",
        message: `RSS feed ${feedId} poll scheduled via Inngest`,
      });
    }

    return NextResponse.json(
      { error: "Unknown trigger or missing feedId" },
      { status: 400 }
    );
  } catch (error) {
    console.error("RSS poll trigger error:", error);
    return NextResponse.json(
      { error: "Failed to trigger RSS poll" },
      { status: 500 }
    );
  }
}

// GET: Health check
export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "RSS poll endpoint active",
    note: "Use POST with { trigger: 'rss-poll' } to run or schedule a poll",
    inngest: Boolean(process.env.INNGEST_EVENT_KEY),
  });
}