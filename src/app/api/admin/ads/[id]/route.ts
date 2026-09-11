import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AD_SLOTS, invalidateSlotAds } from "@/lib/ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return {};
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const existing = await prisma.ad.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Ad not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();
  if (typeof body.slot === "string" && (AD_SLOTS as readonly string[]).includes(body.slot)) data.slot = body.slot;
  if (body.format === "image" || body.format === "html") data.format = body.format;
  if ("imageUrl" in body) data.imageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  if ("html" in body) data.html = typeof body.html === "string" && body.html.trim() ? body.html.trim() : null;
  if ("targetUrl" in body) data.targetUrl = typeof body.targetUrl === "string" && body.targetUrl.trim() ? body.targetUrl.trim() : null;
  if ("sponsor" in body) data.sponsor = typeof body.sponsor === "string" && body.sponsor.trim() ? body.sponsor.trim() : null;
  if (body.weight !== undefined) data.weight = Math.max(1, Math.min(100, Math.trunc(Number(body.weight)) || 1));
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if ("startsAt" in body) data.startsAt = body.startsAt ? new Date(body.startsAt) : null;
  if ("endsAt" in body) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;

  const ad = await prisma.ad.update({ where: { id }, data });

  await invalidateSlotAds(existing.slot);
  if (ad.slot !== existing.slot) await invalidateSlotAds(ad.slot);

  return NextResponse.json({ ad });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const existing = await prisma.ad.findUnique({ where: { id }, select: { slot: true } });
  await prisma.ad.delete({ where: { id } }).catch(() => null);
  if (existing) await invalidateSlotAds(existing.slot);

  return NextResponse.json({ ok: true });
}
