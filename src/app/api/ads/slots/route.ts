import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cacheGet, cacheSet } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/ads/slots?slot=feed-inline — public: get active slot by placement key */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slotKey = searchParams.get("slot");

  if (!slotKey) return NextResponse.json({ error: "slot parameter required" }, { status: 400 });

  const cacheKey = `adslot:${slotKey}`;
  const cached = await cacheGet<{ id: string; scriptTag: string; provider: string; adUnitId: string | null }>(cacheKey).catch(() => null);
  if (cached) return NextResponse.json({ slot: cached });

  const slot = await prisma.thirdPartyAdSlot.findFirst({
    where: { slot: slotKey, isActive: true },
    orderBy: { weight: "desc" },
    select: { id: true, scriptTag: true, provider: true, adUnitId: true, sizes: true },
  });

  if (!slot) return NextResponse.json({ slot: null });

  const payload = { id: slot.id, scriptTag: slot.scriptTag, provider: slot.provider, adUnitId: slot.adUnitId, sizes: slot.sizes };
  await cacheSet(cacheKey, payload, 300).catch(() => {});

  return NextResponse.json({ slot: payload });
}
