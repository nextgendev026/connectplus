import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { AD_SLOTS } from "@/lib/ads";
import { redisDel } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAdmin(role?: string) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

const PROVIDERS = ["adsense", "facebook", "custom", "mgid", "propeller"] as const;

/** GET /api/admin/adslots — list configured third-party slots. */
export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const slots = await prisma.thirdPartyAdSlot.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ slots, providers: PROVIDERS, placements: AD_SLOTS });
}

/** POST /api/admin/adslots — create or update a third-party slot. */
export async function POST(request: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.slot || !body?.provider) {
    return NextResponse.json({ error: "name, slot and provider are required" }, { status: 400 });
  }
  if (!(AD_SLOTS as readonly string[]).includes(body.slot)) {
    return NextResponse.json({ error: `slot must be one of: ${AD_SLOTS.join(", ")}` }, { status: 400 });
  }
  if (!(PROVIDERS as readonly string[]).includes(body.provider)) {
    return NextResponse.json({ error: `provider must be one of: ${PROVIDERS.join(", ")}` }, { status: 400 });
  }

  const data = {
    name: String(body.name),
    slot: String(body.slot),
    provider: String(body.provider),
    scriptTag: body.scriptTag ? String(body.scriptTag) : null,
    adUnitId: body.adUnitId ? String(body.adUnitId) : null,
    sizes: body.sizes ? String(body.sizes) : null,
    isActive: body.isActive !== false,
    weight: Number(body.weight) || 1,
    updatedAt: new Date(),
  };

  const slot = await prisma.thirdPartyAdSlot.upsert({
    where: { name: data.name },
    update: data,
    create: { ...data, createdAt: new Date() },
  });

  // Bust the public slot cache so the change is live immediately.
  await redisDel(`adslot:${slot.slot}`).catch(() => {});

  return NextResponse.json({ ok: true, slot });
}

/** DELETE /api/admin/adslots?id=… — remove a third-party slot. */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const existing = await prisma.thirdPartyAdSlot.findUnique({ where: { id }, select: { slot: true } });
  await prisma.thirdPartyAdSlot.delete({ where: { id } }).catch(() => {});
  if (existing) await redisDel(`adslot:${existing.slot}`).catch(() => {});

  return NextResponse.json({ ok: true });
}
