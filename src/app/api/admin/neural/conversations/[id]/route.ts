import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deriveConversationTitle } from "@/lib/chat-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One conversation: read it back, retitle it, or throw it away.
 *
 * Every handler resolves the thread through `{ id, userId }` rather than by
 * primary key. That single choice is what makes the whole file safe to expose:
 * an id belonging to another admin resolves to nothing, so there is no branch
 * where a missing ownership check could be reintroduced later.
 */
async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") return null;
  return session;
}

export interface ConversationMessageDTO {
  id: string;
  role: string;
  content: string;
  intent: string | null;
  enginesUsed: string[];
  createdAt: string;
  /** Parsed when it was written; null for user turns and older rows. */
  meta: Record<string, unknown> | null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const conversation = await prisma.neuralConversation.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      shareToken: true,
      sharedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, intent: true, enginesUsed: true, metadata: true, createdAt: true },
      },
    },
  });

  if (!conversation) {
    // "Not found" rather than "forbidden", so the response does not confirm that
    // a guessed id exists at all.
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const messages: ConversationMessageDTO[] = conversation.messages.map((m) => {
    let meta: Record<string, unknown> | null = null;
    if (m.metadata) {
      try {
        meta = JSON.parse(m.metadata) as Record<string, unknown>;
      } catch {
        // A row written before the metadata shape settled is still readable; its
        // evidence panel is simply absent rather than breaking the transcript.
        meta = null;
      }
    }
    return {
      id: m.id,
      role: m.role,
      content: m.content,
      intent: m.intent,
      enginesUsed: m.enginesUsed ? m.enginesUsed.split(",").filter(Boolean) : [],
      createdAt: m.createdAt.toISOString(),
      meta,
    };
  });

  return NextResponse.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      shared: Boolean(conversation.shareToken),
      sharedAt: conversation.sharedAt?.toISOString() ?? null,
      // The token is returned to its owner only. Without it, reopening a thread
      // that is already shared would show the share button as "off" and hide a
      // link that is live — and the operator would have no way to recover it
      // short of revoking and re-sharing.
      shareToken: conversation.shareToken,
      messages,
    },
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown };
  const raw = typeof body.title === "string" ? body.title.trim() : "";
  if (raw.length === 0) {
    return NextResponse.json({ error: "A title is required." }, { status: 400 });
  }

  const owned = await prisma.neuralConversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Same title derivation the first message uses, so a rename cannot produce a
  // title longer than the one the system would have generated.
  const updated = await prisma.neuralConversation.update({
    where: { id: owned.id },
    data: { title: deriveConversationTitle(raw, 80) },
    select: { id: true, title: true },
  });

  return NextResponse.json({ conversation: updated });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const owned = await prisma.neuralConversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Messages cascade from the conversation relation, so one delete removes the
  // transcript without a second statement that could half-apply.
  await prisma.neuralConversation.delete({ where: { id: owned.id } });

  return NextResponse.json({ ok: true });
}
