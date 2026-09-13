import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recentDrainRuns } from "@/lib/rss-drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/rss/drain/history?limit=5
 *
 * Durable drain history: recent runs with every per-feed outcome. This is what
 * lets the console answer "which feed failed, and why?" after Redis has expired
 * and the progress bar is gone.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    const role = session?.user?.role;
    if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "5");
    const runs = await recentDrainRuns(Number.isFinite(limit) ? limit : 5);

    return NextResponse.json({
      runs: runs.map((run) => ({
        id: run.id,
        stage: run.stage,
        total: run.total,
        processed: run.processed,
        newArticles: run.newArticles,
        errors: run.errors,
        cancelled: run.cancelled,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        feeds: run.feeds.map((f) => ({
          id: f.id,
          feedId: f.feedId,
          feedName: f.feedName,
          status: f.status,
          newArticles: f.newArticles,
          items: f.items,
          durationMs: f.durationMs,
          error: f.error,
          createdAt: f.createdAt,
        })),
      })),
    });
  } catch {
    return NextResponse.json({ error: "Failed to load drain history" }, { status: 500 });
  }
}
