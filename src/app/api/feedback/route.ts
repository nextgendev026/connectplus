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
    const userId = session?.user?.id ?? null;
    const sessionId =
      typeof (body as { sessionId?: unknown }).sessionId === "string"
        ? (body as { sessionId: string }).sessionId
        : null;

    const cleanEvent = (raw: Record<string, unknown>) => {
      const type = typeof raw.type === "string" ? raw.type : "";
      if (!VALID_TYPES.has(type)) return null;
      const postId = typeof raw.postId === "string" ? raw.postId : null;
      const value = typeof raw.value === "number" && isFinite(raw.value) ? raw.value : null;
      const variant =
        typeof raw.variant === "string" && raw.variant.length <= 64 ? raw.variant : null;
      const rawSession = typeof raw.sessionId === "string" ? raw.sessionId : null;
      return { postId, type, value, variant, sessionId: rawSession };
    };

    const events = (body as { events?: unknown }).events;
    if (Array.isArray(events)) {
      const rows = events
        .filter((e): e is Record<string, unknown> => e != null && typeof e === "object")
        .map(cleanEvent)
        .filter((e): e is NonNullable<ReturnType<typeof cleanEvent>> => e != null)
        .map((e) => ({ ...e, userId }));

      if (rows.length === 0) {
        return NextResponse.json({ ok: true }, { status: 201 });
      }

      await prisma.modelFeedback.createMany({ data: rows });

      // Coalesce affinity after meaningful engagement signals (once per flush).
      if (userId && rows.some((r) => r.type === "like" || r.type === "bookmark")) {
        prisma.$transaction(async () => {
          const { updateUserPreference } = await import("@/lib/neural-vector");
          await updateUserPreference(userId);
        }).catch(() => {});
      }

      return NextResponse.json({ ok: true }, { status: 201 });
    }

    const event = cleanEvent(
      body as Record<string, unknown>
    );
    if (!event) {
      return NextResponse.json({ error: "Invalid feedback type" }, { status: 400 });
    }

    const { postId, type, value, variant, sessionId: eventSessionId } = event;
    await prisma.modelFeedback.create({
      data: {
        userId,
        postId: postId ?? null,
        type,
        value,
        variant: variant ?? null,
        sessionId: eventSessionId ?? sessionId,
      },
    });

    if (userId && (type === "like" || type === "bookmark")) {
      prisma.$transaction(async () => {
        const { updateUserPreference } = await import("@/lib/neural-vector");
        await updateUserPreference(userId);
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("Feedback error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
