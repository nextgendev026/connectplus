import { NextRequest, NextResponse } from "next/server";
import { triggerRssPoll } from "@/lib/inngest-trigger";
import { recoverMissingThumbnails } from "@/lib/rss-poll";

// Cron entrypoint. When Inngest Cloud is connected (INNGEST_EVENT_KEY set) it
// routes into the Inngest queue; otherwise it polls inline so RSS automation
// keeps working. Free Vercel scheduling is limited to 1 cron/day, so daily
// granularity is the floor here and Inngest provides the finer cadence.

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