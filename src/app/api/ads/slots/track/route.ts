import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/ads/slots/track — record impression or click for a third-party ad slot */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.slotId || !body?.type) {
    return NextResponse.json({ error: "slotId and type (impression|click) required" }, { status: 400 });
  }

  const field = body.type === "click" ? "clicks" : "impressions";
  try {
    await prisma.thirdPartyAdSlot.update({
      where: { id: body.slotId },
      data: { [field]: { increment: 1 } },
    });
  } catch {
    // Slot may not exist — ignore silently
  }

  return NextResponse.json({ ok: true });
}
