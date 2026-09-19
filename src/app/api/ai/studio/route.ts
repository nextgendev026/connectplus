import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runStudioBrain, type StudioAction } from "@/lib/neural-studio";
import { cacheIncr } from "@/lib/redis";

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
  "pilot",
  "compose",
  "learn",
];

/** Actions that are meaningless without a draft to read. */
const NEEDS_DRAFT: StudioAction[] = ["rewrite", "continue", "outline", "summarize", "headline", "tags"];

/**
 * Actions that may be called in a burst.
 *
 * The live checker runs on a debounce while the writer types, and the inline
 * pilot fires from a selection toolbar, so both are legitimately chatty. They
 * are throttled rather than blocked — a writer mid-paragraph must never be told
 * they are "rate limited"; the answer just arrives a moment later or, for
 * `inspect`, is skipped because the next keystroke will ask again anyway.
 */
const BURST_ACTIONS: StudioAction[] = ["inspect", "pilot"];
const BURST_LIMIT = 120;
const BURST_WINDOW_SECONDS = 60;

/** The model-backed actions are expensive; they get a much tighter ceiling. */
const MODEL_ACTIONS: StudioAction[] = [
  "rewrite",
  "continue",
  "outline",
  "assist",
  "curate",
  "optimize",
  "plagiarism",
  "pilot",
  // One part of a forged article. Counted with the model actions because each
  // call is a real completion — an article is several of them by design.
  "compose",
];
const MODEL_LIMIT = 30;
const MODEL_WINDOW_SECONDS = 60;

/** A string field from the request body, or "". */
function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Studio Brain Copilot — the read/write bridge between the typing console and
 * the integrated brains.
 *
 * The studio sends the current title/content/selection (read); the brain returns
 * generated/optimised text — or, for `pilot`, a set of structured edits the
 * composer applies in place (write). Every action shares one entry point so the
 * console cannot grow a second, differently-behaved path to the same model.
 *
 * Two hardenings matter here. First, the throttle is per *account*, not per IP,
 * because the abuse this guards against is a compromised or scripted session
 * spending someone else's provider budget — and a shared campus IP is not the
 * thing to punish. Second, a throttle is never a hard failure: the caller is
 * told `retryAfter`, and the studio degrades to the deterministic engines, so a
 * busy writer loses polish, not their draft.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const action = body?.action as StudioAction;
    if (!action || !ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    /* ── Throttle ──────────────────────────────────────────────────────────── */
    if (BURST_ACTIONS.includes(action)) {
      const burst = await cacheIncr(`studio:burst:${userId}`, BURST_WINDOW_SECONDS).catch(() => 0);
      if (burst > BURST_LIMIT) {
        return NextResponse.json(
          { error: "Too many editor requests — give it a second.", retryAfter: BURST_WINDOW_SECONDS },
          { status: 429, headers: { "Retry-After": String(BURST_WINDOW_SECONDS) } }
        );
      }
    }
    if (MODEL_ACTIONS.includes(action)) {
      const spent = await cacheIncr(`studio:model:${userId}`, MODEL_WINDOW_SECONDS).catch(() => 0);
      if (spent > MODEL_LIMIT) {
        return NextResponse.json(
          {
            error: "That is a lot of brain requests in a minute — try again shortly.",
            retryAfter: MODEL_WINDOW_SECONDS,
          },
          { status: 429, headers: { "Retry-After": String(MODEL_WINDOW_SECONDS) } }
        );
      }
    }

    const content = str(body?.content);
    const title = str(body?.title);
    const prompt = str(body?.prompt);
    const selection = str(body?.selection);
    // The composer's other fields, so a whole-post action can see the whole post
    // instead of just the body. Bounded and normalised in `runStudioBrain`.
    const excerpt = str(body?.excerpt);
    const category = str(body?.category);
    const pilotAction = str(body?.pilotAction);
    const tags = Array.isArray(body?.tags)
      ? body.tags.filter((t: unknown): t is string => typeof t === "string")
      : [];

    // Actions that need a draft to operate on. `inspect` and `pilot` are exempt:
    // an empty editor is a clean editor, and the pilot's own answer for an empty
    // draft is more useful than a 400 the UI has to render.
    if (NEEDS_DRAFT.includes(action)) {
      const hasInput = (content || selection || prompt || title).trim().length >= 20;
      if (!hasInput) {
        return NextResponse.json(
          { error: "Write at least 20 characters first so the brain has something to work with." },
          { status: 400 }
        );
      }
    }

    const promptKind = str(body?.promptKind);
    const maxTokens = typeof body?.maxTokens === "number" ? body.maxTokens : undefined;
    const outcomes = Array.isArray(body?.outcomes) ? body.outcomes : undefined;

    const result = await runStudioBrain({
      action,
      title,
      content,
      prompt,
      selection,
      excerpt,
      tags,
      category,
      pilotAction,
      promptKind,
      maxTokens,
      outcomes,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Studio brain error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
