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
  "inspect",
];

/** Actions that are meaningless without a draft to read. */
const NEEDS_DRAFT: StudioAction[] = ["rewrite", "continue", "outline", "summarize", "headline", "tags"];

/** A string field from the request body, or "". */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

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

    const content = str(body?.content);
    const title = str(body?.title);
    const prompt = str(body?.prompt);
    const selection = str(body?.selection);
    // The composer's other fields, so a whole-post action can see the whole post
    // instead of just the body. Bounded and normalised in `runStudioBrain`.
    const excerpt = str(body?.excerpt);
    const category = str(body?.category);
    const tags = Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : [];

    // Actions that need a draft to operate on. `inspect` is exempt: an empty
    // editor is a clean editor, and the live checker is called on every pause.
    if (NEEDS_DRAFT.includes(action)) {
      const hasInput = (content || selection || prompt || title).trim().length >= 20;
      if (!hasInput) {
        return NextResponse.json(
          { error: "Write at least 20 characters first so the brain has something to work with." },
          { status: 400 }
        );
      }
    }

    const result = await runStudioBrain({ action, title, content, prompt, selection, excerpt, tags, category });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Studio brain error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}