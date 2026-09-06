import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/lib/inngest";

// This endpoint triggers Inngest functions instead of running directly
// Vercel free tier limits: 1 cron minute, 10s function timeout
// Inngest: Unlimited scheduling, no function timeout restrictions

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const trigger = searchParams.get("trigger");

  if (trigger === "rss-poll") {
    // Trigger the Inngest RSS poll function
    await inngest.send({
      name: "rss-poll",
    });

    return NextResponse.json({ 
      success: true, 
      message: "RSS poll triggered via Inngest"
    });
  }

  return NextResponse.json({ 
    availableTriggers: ["rss-poll"],
    message: "Use ?trigger=rss-poll to start RSS polling"
  });
}

// POST: Manual trigger from admin panel or frontend
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { trigger } = body;

  if (trigger === "rss-poll") {
    await inngest.send({
      name: "rss-poll",
    });

    return NextResponse.json({ 
      success: true, 
      message: "RSS poll triggered via Inngest POST"
    });
  }

  return NextResponse.json(
    { error: "Unknown trigger" },
    { status: 400 }
  );
}