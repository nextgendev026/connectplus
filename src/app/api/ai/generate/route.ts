import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateHeadline, generateExcerpt, generateTopics, type GenerateType } from "@/lib/neural-generate";

/**
 * On-device AI content generation (Phase 4): headline, excerpt, and topic
 * suggestion. Deterministic + dependency-free — no external model API, so it is
 * fast, private, and works in serverless. Lagging ingestion of a real LLM can
 * swap in behind this same contract.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { type = "excerpt", title = "", content = "" } = body as { type?: GenerateType; title?: string; content?: string };

    if (!content || typeof content !== "string" || content.trim().length < 40) {
      return NextResponse.json({ error: "Content must be at least 40 characters" }, { status: 400 });
    }

    if (!["headline", "excerpt", "topics"].includes(type)) {
      return NextResponse.json({ error: "Invalid generation type" }, { status: 400 });
    }

    const result =
      type === "headline"
        ? generateHeadline(title || "Untitled", content)
        : type === "excerpt"
          ? generateExcerpt(title, content)
          : generateTopics(content);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("AI generate error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}