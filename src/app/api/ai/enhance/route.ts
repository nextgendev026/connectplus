import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { enhanceText } from "@/lib/neural-generate";

/**
 * Phase 2/4 content intelligence: on-demand readability & clarity analysis for
 * a draft. Deterministic, dependency-free — returns a quality score, grade, and
 * actionable rewrite suggestions for the studio's AI Content Studio panel.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const { content = "" } = body as { content?: string };

    if (!content || typeof content !== "string" || content.trim().length < 40) {
      return NextResponse.json({ error: "Content must be at least 40 characters" }, { status: 400 });
    }

    return NextResponse.json(enhanceText(content), { status: 200 });
  } catch (error) {
    console.error("AI enhance error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}