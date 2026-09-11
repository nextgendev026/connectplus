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
  return { userId: session.user.id };
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const ads = await prisma.ad.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "desc" }] });

  const summary = {
    total: ads.length,
    active: ads.filter((a) => a.isActive).length,
    impressions: ads.reduce((n, a) => n + a.impressions, 0),
    clicks: ads.reduce((n, a) => n + a.clicks, 0),
  };

  return NextResponse.json({ ads, slots: AD_SLOTS, summary });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "A campaign name is required" }, { status: 400 });

  const slot = typeof body.slot === "string" ? body.slot : "feed-inline";
  if (!(AD_SLOTS as readonly string[]).includes(slot)) {
    return NextResponse.json({ error: "Unknown slot" }, { status: 400 });
  }

  const format = body.format === "html" ? "html" : "image";
  const imageUrl = typeof body.imageUrl === "string" && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  const html = typeof body.html === "string" && body.html.trim() ? body.html.trim() : null;

  if (format === "image" && !imageUrl) {
    return NextResponse.json({ error: "Image creatives need an image URL" }, { status: 400 });
  }
  if (format === "html" && !html) {
    return NextResponse.json({ error: "HTML creatives need embed markup" }, { status: 400 });
  }

  const weight = Number.isFinite(Number(body.weight)) ? Math.max(1, Math.min(100, Math.trunc(Number(body.weight)))) : 1;

  const ad = await prisma.ad.create({
    data: {
      name,
      slot,
      format,
      imageUrl,
      html,
      targetUrl: typeof body.targetUrl === "string" && body.targetUrl.trim() ? body.targetUrl.trim() : null,
      sponsor: typeof body.sponsor === "string" && body.sponsor.trim() ? body.sponsor.trim() : null,
      weight,
      isActive: body.isActive !== false,
      startsAt: body.startsAt ? new Date(body.startsAt) : null,
      endsAt: body.endsAt ? new Date(body.endsAt) : null,
      createdBy: guard.userId ?? null,
    },
  });

  await invalidateSlotAds(slot);
  return NextResponse.json({ ad }, { status: 201 });
}
