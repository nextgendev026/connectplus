import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const VALID_TYPES = new Set([
  "impression",
  "click",
  "like",
  "bookmark",
  "share",
  "time_spent",
  "comment",
]);

/**
 * Logs interaction feedback used by the learning loop (Phase 3). Authorized
 * requests are attributed to the user; otherwise they fall back to a session id.
 * No write is ever fatal — failures are swallowed so browsing is never blocked.
 */
export async function POST(request: NextRequest) {
  try {
    let session = null;
    try {
      session = await auth();
    } catch {
      session = null;
    }

    const body = await request.json().catch(() => ({}));
    const { postId, type, value, variant, sessionId } = body as {
      postId?: string;
      type?: string;
      value?: number;
      variant?: string;
      sessionId?: string;
    };

    if (!type || !VALID_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid feedback type" }, { status: 400 });
    }

    const userId = session?.user?.id ?? null;
    const v = typeof value === "number" && isFinite(value) ? value : null;
    const cleanVariant =
      typeof variant === "string" && variant.length <= 64 ? variant : null;
    if (userId) {
      await prisma.modelFeedback.create({
        data: {
          userId,
          postId: postId ?? null,
          type,
          value: v,
          variant: cleanVariant,
          sessionId: sessionId ?? null,
        },
      });

      // Coalesce affinity after meaningful engagement signals.
      if (type === "like" || type === "bookmark") {
        prisma.$transaction(async () => {
          const { updateUserPreference } = await import("@/lib/neural-vector");
          await updateUserPreference(userId);
        }).catch(() => {});
      }
    } else if (sessionId) {
      await prisma.modelFeedback.create({
        data: {
          postId: postId ?? null,
          type,
          value: v,
          variant: cleanVariant,
          sessionId,
        },
      });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
