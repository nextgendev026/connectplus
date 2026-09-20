import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { triggerRssPoll } from "@/lib/inngest-trigger";

/**
 * Manual trigger — admin only.
 *
 * The comment on this handler always said "for admin panel", and nothing ever
 * checked. `POST {"trigger":"rss-poll"}` with no session set the entire
 * ingestion pipeline running on demand, so any anonymous visitor could burn
 * feed fetches, image work and database writes at will. On a platform whose
 * budget is a set of free tiers, an unauthenticated "do expensive work now"
 * button is the cheapest possible denial of service.
 *
 * The scheduled path does not come through here — the cron and Inngest call
 * `triggerRssPoll` directly — so gating this costs automation nothing.
 */
async function requireAdmin(): Promise<NextResponse | null> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  return null;
}

// Body: { trigger: "rss-poll" } or { trigger: "rss-poll-feed", feedId: "feed_123" }

export async function POST(request: NextRequest) {
  try {
    const denied = await requireAdmin();
    if (denied) return denied;

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