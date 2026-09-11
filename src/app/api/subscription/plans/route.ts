import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/subscription/plans — public list of plans; optionally filter by ?audience=reader|writer */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const audience = searchParams.get("audience");

  const where: Record<string, unknown> = { isActive: true };
  if (audience && (audience === "reader" || audience === "writer")) {
    where.audience = audience;
  }

  const plans = await prisma.subscriptionPlan.findMany({
    where,
    orderBy: [{ audience: "asc" }, { sortOrder: "asc" }],
  });

  return NextResponse.json({
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      displayName: p.displayName,
      tier: p.tier,
      audience: p.audience,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      currency: p.currency,
      features: JSON.parse(p.features),
      limits: JSON.parse(p.limits),
    })),
  });
}

/** POST /api/subscription/plans — admin: create or update a plan */
export async function POST(request: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (role !== "SUPER_ADMIN" && role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.name || !body?.tier || !body?.audience) {
    return NextResponse.json({ error: "name, tier, and audience are required" }, { status: 400 });
  }

  const now = new Date();
  const plan = await prisma.subscriptionPlan.upsert({
    where: { name: body.name },
    update: {
      displayName: body.displayName || body.name,
      tier: body.tier,
      audience: body.audience,
      priceMonthly: body.priceMonthly ?? 0,
      priceYearly: body.priceYearly ?? 0,
      currency: body.currency || "USD",
      features: JSON.stringify(body.features || []),
      limits: JSON.stringify(body.limits || {}),
      isActive: body.isActive !== false,
      sortOrder: body.sortOrder ?? 0,
      updatedAt: now,
    },
    create: {
      name: body.name,
      displayName: body.displayName || body.name,
      tier: body.tier,
      audience: body.audience,
      priceMonthly: body.priceMonthly ?? 0,
      priceYearly: body.priceYearly ?? 0,
      currency: body.currency || "USD",
      features: JSON.stringify(body.features || []),
      limits: JSON.stringify(body.limits || {}),
      isActive: body.isActive !== false,
      sortOrder: body.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    },
  });

  return NextResponse.json({ ok: true, plan: { id: plan.id, name: plan.name } });
}
