import { NextRequest, NextResponse } from "next/server";
import { triggerRssPoll } from "@/lib/inngest-trigger";
import { recoverMissingThumbnails } from "@/lib/rss-poll";

// Legacy/manual RSS trigger. Inngest's own hourly cron now owns the schedule
// (src/inngest/functions.ts); this endpoint remains for external schedulers and
// the admin console. When Inngest Cloud is connected it routes the poll into
// the queue, otherwise it polls inline so RSS automation keeps working either
// way. Vercel's single cron slot is spent on /api/cron/safety-net instead.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trigger = searchParams.get("trigger");

  if (trigger === "rss-poll") {
    // `inline=1` forces the work into this request instead of the Inngest
    // queue — the escape hatch when the queue is not wired up.
    const inline = searchParams.get("inline") === "1";
    const result = await triggerRssPoll(undefined, { inline });

    if (result.mode === "direct") {
      return NextResponse.json({
        success: true,
        mode: "direct",
        summary: result.summary,
      });
    }

    return NextResponse.json({
      success: true,
      mode: "inngest",
      eventIds: result.eventIds,
      message: "RSS poll queued via Inngest",
    });
  }

  if (trigger === "recover-thumbnails") {
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "25"), 1), 100);
    const summary = await recoverMissingThumbnails({ limit });
    return NextResponse.json({ success: true, mode: "direct", summary });
  }

  return NextResponse.json({
    availableTriggers: ["rss-poll", "recover-thumbnails"],
    message: "Use ?trigger=rss-poll (optionally &inline=1) or ?trigger=recover-thumbnails",
  });
}

// POST: Manual trigger from admin panel or frontend
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { trigger } = body;

  if (trigger === "rss-poll") {
    const result = await triggerRssPoll(undefined, { inline: body?.inline === true });

    if (result.mode === "direct") {
      return NextResponse.json({ success: true, mode: "direct", summary: result.summary });
    }

    return NextResponse.json({
      success: true,
      mode: "inngest",
      eventIds: result.eventIds,
      message: "RSS poll queued via Inngest",
    });
  }

  return NextResponse.json({ error: "Unknown trigger" }, { status: 400 });
}