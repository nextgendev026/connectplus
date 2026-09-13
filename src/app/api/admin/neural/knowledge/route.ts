import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { knowledgeDigest, learnTopic } from "@/lib/mind-knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const log = createLogger("admin-knowledge");

/**
 * The operator's lever on what the combined mind knows about the world.
 *
 * `neural-mind` researches opportunistically whenever someone asks it something,
 * which means the mind's outside knowledge only ever reflects the questions that
 * happened to be asked. An operator usually knows what the platform is *about* —
 * a league, a beat, a competitor — long before anyone asks. This endpoint lets
 * them file it directly.
 *
 *   GET  /api/admin/neural/knowledge  → digest: how much it holds, and from where
 *   POST /api/admin/neural/knowledge  → { query, sources?, tags? } and file it
 *
 * POST is idempotent: sources already filed are skipped, so a subject can be
 * refreshed on a schedule without duplicating memory rows.
 */

async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") return null;
  return session;
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const digest = await knowledgeDigest();
  return NextResponse.json({ digest });
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    query?: unknown;
    sources?: unknown;
    tags?: unknown;
  };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query.length < 3) {
    return NextResponse.json({ error: "Give a subject to learn about." }, { status: 400 });
  }

  const sources = Math.min(Math.max(Number(body.sources ?? 3) || 3, 1), 6);
  // `sports` is a meaningful tag, not decoration: only sport-tagged web
  // knowledge is allowed into the prediction engine's corpus, so letting the
  // operator label a subject is what decides whether the model can ever cite it.
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.length > 0 && t.length < 24).slice(0, 6)
    : [];

  const result = await learnTopic(query, { maxSources: sources, tags });
  log.info("operator filed web knowledge", {
    query: query.slice(0, 80),
    stored: result.stored,
    skipped: result.skipped,
    tags,
  });

  return NextResponse.json({
    ok: true,
    learned: result,
    digest: await knowledgeDigest(),
    // Say plainly when nothing was filed, rather than letting a zero look like
    // a success: "already known" and "the search returned nothing usable" are
    // different outcomes and an operator should not have to guess which.
    note:
      result.stored > 0
        ? `Filed ${result.stored} source${result.stored === 1 ? "" : "s"}.`
        : result.skipped > 0
          ? "Every usable source was already in memory."
          : "No readable sources were found for that subject.",
  });
}
