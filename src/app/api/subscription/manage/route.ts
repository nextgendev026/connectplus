import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/subscription/manage — get current user's subscription(s) */
export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const subscriptions = await prisma.userSubscription.findMany({
    where: { userId },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      status: s.status,
      billingCycle: s.billingCycle,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      usageThisPeriod: s.usageThisPeriod,
      plan: {
        id: s.plan.id,
        name: s.plan.name,
        displayName: s.plan.displayName,
        tier: s.plan.tier,
        audience: s.plan.audience,
        priceMonthly: s.plan.priceMonthly,
        priceYearly: s.plan.priceYearly,
        features: JSON.parse(s.plan.features),
        limits: JSON.parse(s.plan.limits),
      },
    })),
  });
}

/** POST /api/subscription/manage — subscribe to a plan or cancel */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;
  const body = await request.json().catch(() => null);

  if (!body?.action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  // Subscribe to a plan
  if (body.action === "subscribe") {
    if (!body.planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId } });
    if (!plan || !plan.isActive) return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });

    const now = new Date();
    const periodEnd = new Date(now);
    if (body.billingCycle === "yearly") {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Check if user already has an active sub to this plan
    const existing = await prisma.userSubscription.findUnique({
      where: { userId_planId: { userId, planId: body.planId } },
    });

    if (existing && existing.status === "active") {
      return NextResponse.json({ error: "Already subscribed to this plan" }, { status: 409 });
    }

    const sub = await prisma.userSubscription.upsert({
      where: { userId_planId: { userId, planId: body.planId } },
      update: {
        status: "active",
        billingCycle: body.billingCycle || "monthly",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        usageThisPeriod: 0,
        updatedAt: now,
      },
      create: {
        userId,
        planId: body.planId,
        status: "active",
        billingCycle: body.billingCycle || "monthly",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        usageThisPeriod: 0,
        createdAt: now,
        updatedAt: now,
      },
    });

    return NextResponse.json({ ok: true, subscription: { id: sub.id, status: sub.status } });
  }

  // Cancel subscription
  if (body.action === "cancel") {
    if (!body.subscriptionId) return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });

    const sub = await prisma.userSubscription.findFirst({
      where: { id: body.subscriptionId, userId },
    });
    if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

    const updated = await prisma.userSubscription.update({
      where: { id: body.subscriptionId },
      data: {
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, subscription: { id: updated.id, cancelAtPeriodEnd: updated.cancelAtPeriodEnd } });
  }

  // Reactivate cancelled subscription
  if (body.action === "reactivate") {
    if (!body.subscriptionId) return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });

    const sub = await prisma.userSubscription.findFirst({
      where: { id: body.subscriptionId, userId },
    });
    if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

    const updated = await prisma.userSubscription.update({
      where: { id: body.subscriptionId },
      data: {
        cancelAtPeriodEnd: false,
        status: "active",
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true, subscription: { id: updated.id, status: updated.status } });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
