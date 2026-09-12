import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripe, stripeConfigured, appUrl, periodWindow } from "@/lib/stripe";

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
      managedByStripe: Boolean(s.stripeSubscriptionId),
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

/**
 * POST /api/subscription/manage
 *   subscribe(userId, planId, billingCycle) — free plans are granted locally;
 *     paid plans open a Stripe Checkout session and return its URL.
 *   cancel(subscriptionId) — next-cycle cancellation (local or via Stripe).
 *   reactivate(subscriptionId) — un-cancel before the period end.
 *   portal(subscriptionId?) — open the Stripe billing portal for the sub.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await request.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  switch (body.action) {
    case "subscribe":
      return subscribe(userId, body);
    case "cancel":
      return cancel(userId, body);
    case "reactivate":
      return reactivate(userId, body);
    case "portal":
      return portal(userId, body);
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

async function subscribe(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!body.planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId as string } });
  if (!plan || !plan.isActive) return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });

  const billingCycle = body.billingCycle === "yearly" ? "yearly" : "monthly";
  const now = new Date();

  const existing = await prisma.userSubscription.findUnique({
    where: { userId_planId: { userId, planId: plan.id } },
  });
  if (existing && (existing.status === "active" || existing.status === "trialing")) {
    return NextResponse.json({ error: "Already subscribed to this plan" }, { status: 409 });
  }

  // Free plans are granted locally — no Stripe involvement.
  if (plan.tier === "free" || plan.priceMonthly === 0) {
    const periodEnd = periodWindow(billingCycle, now).end;
    const sub = await prisma.userSubscription.upsert({
      where: { userId_planId: { userId, planId: plan.id } },
      update: {
        status: "active",
        billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        usageThisPeriod: 0,
        updatedAt: now,
      },
      create: {
        userId,
        planId: plan.id,
        status: "active",
        billingCycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        usageThisPeriod: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    return NextResponse.json({ ok: true, free: true, subscription: { id: sub.id, status: sub.status } });
  }

  // Paid plans require the billing stack.
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Billing isn't configured yet — please try again later.", code: "BILLING_NOT_CONFIGURED" },
      { status: 503 }
    );
  }
  const stripe = getStripe()!;
  const priceId =
    billingCycle === "yearly" ? plan.stripePriceYearlyId : plan.stripePriceMonthlyId;
  if (!priceId) {
    return NextResponse.json(
      {
        error: `No Stripe price is linked to this plan yet (${billingCycle} billing).`,
        code: "PLAN_PRICE_MISSING",
      },
      { status: 409 }
    );
  }

  const session = await auth();
  const email = ((session?.user as { email?: string | null })?.email ?? undefined) || undefined;

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      metadata: { userId, planId: plan.id, billingCycle, planName: plan.name },
    },
    metadata: { userId, planId: plan.id, billingCycle, planName: plan.name },
    success_url: `${appUrl()}/settings?checkout=success`,
    cancel_url: `${appUrl()}/pricing?checkout=cancelled`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ ok: true, free: false, checkoutUrl: checkout.url });
}

async function cancel(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!body.subscriptionId) return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });

  const sub = await prisma.userSubscription.findFirst({
    where: { id: body.subscriptionId as string, userId },
  });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  if (sub.stripeSubscriptionId && stripeConfigured()) {
    await getStripe()!.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  const updated = await prisma.userSubscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: true, updatedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    subscription: { id: updated.id, cancelAtPeriodEnd: updated.cancelAtPeriodEnd },
  });
}

async function reactivate(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!body.subscriptionId) return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });

  const sub = await prisma.userSubscription.findFirst({
    where: { id: body.subscriptionId as string, userId },
  });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  if (sub.stripeSubscriptionId && stripeConfigured()) {
    await getStripe()!.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: false,
    });
  }

  const updated = await prisma.userSubscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: false, status: "active", updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, subscription: { id: updated.id, status: updated.status } });
}

async function portal(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Billing isn't configured yet — please try again later.", code: "BILLING_NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const whereOptions: Prisma.UserSubscriptionWhereInput = body.subscriptionId
    ? { id: body.subscriptionId as string, userId }
    : { userId, status: { in: ["active", "trialing"] } };

  const sub = await prisma.userSubscription.findFirst({
    where: whereOptions,
    orderBy: { updatedAt: "desc" },
  });

  const customerId = sub?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json({ error: "No billing portal available for this membership." }, { status: 404 });
  }

  const session = await getStripe()!.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/settings`,
  });

  return NextResponse.json({ ok: true, portalUrl: session.url });
}