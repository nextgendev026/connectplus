import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runStudioBrain, type StudioAction } from "@/lib/neural-studio";

const ACTIONS: StudioAction[] = [
  "rewrite",
  "continue",
  "outline",
  "summarize",
  "headline",
  "tags",
  "curate",
  "assist",
  "seo",
  "plagiarism",
  "optimize",
];

/**
 * Studio Brain Copilot — the read/write bridge between the typing console and
 * the integrated brains. The studio sends the current title/content/selection
 * (read), the brain returns generated/optimised text (write), and the UI
 * applies it directly to the editor, title, excerpt or tag list.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json();
    const action = body?.action as StudioAction;
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    const content: string = typeof body?.content === "string" ? body.content : "";
    const title: string = typeof body?.title === "string" ? body.title : "";
    const prompt: string = typeof body?.prompt === "string" ? body.prompt : "";
    const selection: string = typeof body?.selection === "string" ? body.selection : "";

    // Actions that need a draft to operate on.
    if (["rewrite", "continue", "outline", "summarize", "headline", "tags"].includes(action)) {
      const hasInput = (content || selection || prompt || title).trim().length >= 20;
      if (!hasInput) {
        return NextResponse.json(
          { error: "Write at least 20 characters first so the brain has something to work with." },
          { status: 400 }
        );
      }
    }

    const result = await runStudioBrain({ action, title, content, prompt, selection });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Studio brain error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}