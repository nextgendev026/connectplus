import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { toConversationSummary, type ConversationSummary } from "@/lib/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = createLogger("neural-history");

/**
 * The chat history list.
 *
 * Until now a conversation was written on every question and never read back:
 * the floating widget sent no conversation id, so each turn created a new thread
 * and no surface ever showed the operator their own past. The rows were all
 * there — 108 conversations, 100 of them a single exchange — and none of it was
 * reachable. This is the read path that makes the storage worth having.
 *
 * Scoped to the session user at the query, not filtered after. An admin's thread
 * is their own; there is no role that makes another admin's conversation
 * readable through this endpoint.
 *
 * `updatedAt` rather than `createdAt` orders the list: a thread resumed this
 * morning belongs at the top even if it was opened last week, which is what a
 * reader means by "recent".
 */
async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") return null;
  return session;
}

/** Kept for existing importers; the mapper itself now lives in lib/chat-history. */
export type ConversationSummaryDTO = ConversationSummary;

/**
 * Why a request was refused, in one word.
 *
 * The console renders an empty list for *any* non-2xx response, so from the
 * outside "this admin has no saved chats" and "this request was refused" look
 * identical. Distinguishing them here is what turns that into a single log line
 * an operator can act on: a missing session is a signed-out tab, a wrong role is
 * a permissions problem, and an empty id is a token fault — three different
 * fixes that an anonymous 403 cannot tell apart.
 */
function refusalReason(role: string | undefined, id: string | undefined): string {
  if (!role) return "no-session";
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") return `role:${role}`;
  if (!id) return "session-without-user-id";
  return "unknown";
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    logger.warn("saved-chat list refused", {
      reason: refusalReason(session?.user?.role, session?.user?.id),
    });
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 30, 1), 100);
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80);

  try {
    const conversations = await prisma.neuralConversation.findMany({
      where: {
        userId: session.user.id,
        ...(search
          ? {
              OR: [
                { title: { contains: search, mode: "insensitive" as const } },
                // Matching message bodies, so an operator who remembers a phrase but
                // not the title can still find the thread that contained it.
                { messages: { some: { content: { contains: search, mode: "insensitive" as const } } } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        shareToken: true,
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, role: true },
        },
      },
    });

    // Counting from the unfiltered set is deliberate: the console shows "N
    // conversations", and a number that silently meant "N matching this search"
    // would read as data loss the moment an operator typed in the box.
    const items: ConversationSummary[] = conversations.map(toConversationSummary);

    return NextResponse.json({ conversations: items });
  } catch (error) {
    // A throw here used to surface as an unhandled 500, which the console could
    // only render as an empty list — the report "my saved chats cannot be
    // fetched" with nothing anywhere saying why. The message is logged in full
    // and the caller gets the status they need to act on.
    const message = error instanceof Error ? error.message : String(error);
    logger.error("saved-chat list failed", { userId: session.user.id, error: message });
    return NextResponse.json({ error: "Your chat history could not be read." }, { status: 500 });
  }
}
