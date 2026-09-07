import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

// Manual trigger endpoint for admin panel
// Body: { trigger: "rss-poll" } or { trigger: "rss-poll-feed", feedId: "feed_123" }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { trigger, feedId } = body;

    if (trigger === "rss-poll") {
      // Trigger Inngest RSS poll function
      await inngest.send({
        name: "rss-poll",
      });

      return NextResponse.json({ 
        success: true, 
        message: "RSS poll scheduled via Inngest - will run on next schedule"
      });
    }

    if (trigger === "rss-poll-feed" && feedId) {
      // Trigger specific feed poll, passing the feedId in the event payload
      await inngest.send({
        name: "rss-poll-feed",
        data: { feedId },
      });

      return NextResponse.json({ 
        success: true, 
        message: `RSS feed ${feedId} poll scheduled via Inngest`
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
export async function GET(request: NextRequest) {
  return NextResponse.json({ 
    status: "ok", 
    message: "RSS poll endpoint active",
    note: "Use POST with { trigger: 'rss-poll' } to schedule via Inngest"
  });
}