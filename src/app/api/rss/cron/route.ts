import { NextRequest, NextResponse } from "next/server";
import { triggerRssPoll } from "@/lib/inngest-trigger";

// Cron entrypoint. When Inngest Cloud is connected (INNGEST_EVENT_KEY set) it
// routes into the Inngest queue; otherwise it polls inline so RSS automation
// keeps working. Free Vercel scheduling is limited to 1 cron/day, so daily
// granularity is the floor here and Inngest provides the finer cadence.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trigger = searchParams.get("trigger");

  if (trigger === "rss-poll") {
    const result = await triggerRssPoll();

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
      message: "RSS poll scheduled via Inngest",
    });
  }

  return NextResponse.json({
    availableTriggers: ["rss-poll"],
    message: "Use ?trigger=rss-poll to start RSS polling",
  });
}

// POST: Manual trigger from admin panel or frontend
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { trigger } = body;

  if (trigger === "rss-poll") {
    const result = await triggerRssPoll();

    if (result.mode === "direct") {
      return NextResponse.json({ success: true, mode: "direct", summary: result.summary });
    }

    return NextResponse.json({
      success: true,
      mode: "inngest",
      message: "RSS poll scheduled via Inngest",
    });
  }

  return NextResponse.json({ error: "Unknown trigger" }, { status: 400 });
}