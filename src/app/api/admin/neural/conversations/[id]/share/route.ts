import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn a conversation into a link, or take the link away.
 *
 * The transcript is worth sharing — a debugging thread that ends in a diagnosis
 * is the kind of thing that belongs in an incident note — but a conversation can
 * also contain readings about revenue, moderation and individual accounts, so
 * this is off by default, per thread, and reversible.
 *
 * Three deliberate choices:
 *
 *   • **The token is random, not derived.** 24 bytes from the CSPRNG, so a link
 *     cannot be guessed from a conversation id that is already visible in the
 *     console and in audit rows.
 *   • **Revoking nulls the token.** The old link stops resolving. A "shared"
 *     flag alone would leave a live URL behind a hidden button.
 *   • **The public view is narrower than the console view.** See the share page:
 *     it renders what was said, not the internal readings that grounded it.
 */
async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") return null;
  return session;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { enable?: unknown };
  const enable = body.enable !== false;

  // Resolved through `{ id, userId }`: only the admin who owns the thread can
  // share it, and an id that is not theirs resolves to nothing.
  const owned = await prisma.neuralConversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, shareToken: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (!enable) {
    await prisma.neuralConversation.update({
      where: { id: owned.id },
      data: { shareToken: null, sharedAt: null },
    });
    return NextResponse.json({ ok: true, shared: false, token: null });
  }

  // Reusing an existing token keeps a link already circulating working when the
  // operator toggles sharing off and on again.
  const token = owned.shareToken ?? randomBytes(24).toString("base64url");
  const updated = await prisma.neuralConversation.update({
    where: { id: owned.id },
    data: { shareToken: token, sharedAt: new Date() },
    select: { sharedAt: true },
  });

  return NextResponse.json({
    ok: true,
    shared: true,
    token,
    path: `/share/chat/${token}`,
    sharedAt: updated.sharedAt?.toISOString() ?? null,
  });
}
