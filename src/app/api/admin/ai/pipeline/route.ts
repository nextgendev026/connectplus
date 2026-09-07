import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { FEED_RANK_VARIANTS } from "@/lib/experiments";

function isAdmin(role?: string) {
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

/**
 * Superadmin pipeline overview (Phase 0-4). Aggregates the state of every AI
 * pipeline: semantic index, content intelligence, learning loop, and generation.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!isAdmin((session.user as { role?: string }).role)) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const [embeddingsCount, publishedCount, feedbackCount, preferencesCount, pendingMod, flaggedPosts, rejectedCount, recentFeedback, recentGenerated] =
      await Promise.all([
        prisma.postEmbedding.count(),
        prisma.post.count({ where: { status: "PUBLISHED" } }),
        prisma.modelFeedback.count(),
        prisma.userPreference.count(),
        prisma.post.count({ where: { moderationStatus: "PENDING" } }),
        prisma.post.findMany({
          where: { moderationStatus: { in: ["FLAGGED", "REJECTED"] }, status: { in: ["PUBLISHED", "DRAFT"] } },
          take: 15,
          orderBy: { updatedAt: "desc" },
          select: { id: true, title: true, moderationStatus: true, aiScore: true, aiFlags: true, status: true, slug: true },
        }),
        prisma.post.count({ where: { moderationStatus: "REJECTED" } }),
        prisma.modelFeedback.findMany({
          take: 8,
          orderBy: { createdAt: "desc" },
          select: { id: true, type: true, value: true, userId: true, createdAt: true },
        }),
        prisma.postEmbedding.count({ where: { model: { not: "hash-minilm" } } }),
      ]);

    const engagementByType = await prisma.modelFeedback.groupBy({
      by: ["type"],
      _count: { _all: true },
    });

    // Phase 3: A/B experiment telemetry — feedback split by feed-rank variant.
    const experimentEvents = await prisma.modelFeedback.groupBy({
      by: ["variant", "type"],
      _count: { _all: true },
    });
    const experiments = {
      feedRank: {
        variants: FEED_RANK_VARIANTS,
        events: experimentEvents.map((e) => ({
          variant: e.variant ?? "none",
          type: e.type,
          count: e._count._all,
        })),
      },
    };

    const duplicateFlagged = await prisma.post.count({
      where: { aiFlags: { contains: "duplicate:" } },
    });

    return NextResponse.json({
      role: (session.user as { role?: string }).role ?? "ADMIN",
      pipeline: {
        semantic: {
          indexedPosts: embeddingsCount,
          publishedPosts: publishedCount,
          coverage: publishedCount ? Math.round((embeddingsCount / publishedCount) * 100) : 100,
          model: "hash-minilm",
        },
        moderation: {
          pending: pendingMod,
          rejected: rejectedCount,
          flagged: flaggedPosts.length,
          duplicates: duplicateFlagged,
        },
        learning: {
          feedbackEvents: feedbackCount,
          userPreferences: preferencesCount,
          engagement: Object.fromEntries(engagementByType.map((e) => [e.type, e._count._all])),
          experiments,
        },
        generation: {
          usesCustomModel: recentGenerated,
        },
      },
      flaggedPosts,
      recentFeedback,
    });
  } catch (error) {
    console.error("AI pipeline overview error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Superadmin-only pipeline executor: rebuild semantic embeddings, refresh user
 * preferences, and re-scan published content through moderation. Mirrors the
 * roadmap's "superadmin fidelity to run every pipeline".
 */
export async function POST(_request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Superadmin access required" }, { status: 403 });
    }

    type PipelineStep = { name: string; built: number };

    const embedded = await import("@/lib/neural-vector").then(({ indexPublishedPosts }) => indexPublishedPosts(400));
    const step1: PipelineStep = { name: "semantic-embeddings", built: embedded };

    const signalUsers = await prisma.modelFeedback.groupBy({
      by: ["userId"],
      where: { userId: { not: null }, type: { in: ["like", "bookmark", "click"] } },
      _count: { _all: true },
    });
    let prefsBuilt = 0;
    const { updateUserPreference } = await import("@/lib/neural-vector");
    for (const g of signalUsers) {
      if (!g.userId) continue;
      try {
        await updateUserPreference(g.userId);
        prefsBuilt++;
      } catch {
        /* skip individual failures */
      }
    }
    const step2: PipelineStep = { name: "user-preferences", built: prefsBuilt };

    const { moderateContent } = await import("@/lib/moderation");
    const published = await prisma.post.findMany({
      where: { status: "PUBLISHED" },
      select: { id: true, title: true, content: true, moderationStatus: true, aiScore: true, aiFlags: true },
    });
    let rescanned = 0;
    for (const p of published) {
      const risk = moderateContent(p.title, p.content);
      const keptStatus =
        p.moderationStatus === "REJECTED" && risk.suggested !== "REJECTED" ? "REJECTED" : p.moderationStatus;
      const needsUpdate =
        risk.score !== p.aiScore || (risk.flags.join(",") || null) !== p.aiFlags || risk.suggested !== keptStatus;
      if (needsUpdate) {
        await prisma.post.update({
          where: { id: p.id },
          data: {
            aiScore: risk.score,
            aiFlags: risk.flags.join(",") || null,
            ...(risk.suggested === "REJECTED" ? { moderationStatus: "REJECTED" } : {}),
          },
        });
      }
      rescanned++;
    }
    const step3: PipelineStep = { name: "moderation-rescan", built: rescanned };

    return NextResponse.json({ ok: true, steps: [step1, step2, step3] });
  } catch (error) {
    console.error("AI pipeline run error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}