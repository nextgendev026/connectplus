import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export interface ConversationSummaryDTO {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** The most recent thing said, so the list is scannable without opening it. */
  preview: string;
  shared: boolean;
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit")) || 30, 1), 100);
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80);

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

  const items: ConversationSummaryDTO[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count.messages,
    preview: (c.messages[0]?.content ?? "").replace(/\s+/g, " ").slice(0, 140),
    shared: Boolean(c.shareToken),
  }));

  return NextResponse.json({ conversations: items });
}
