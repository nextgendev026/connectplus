import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  PaymentProviderError,
  anyPaymentProviderConfigured,
  normalizeCycle,
  paymentProviders,
  periodWindow,
  providerConfigured,
  type PaymentProviderId,
} from "@/lib/payments";
import { startCheckout } from "@/lib/payments/checkout";
import { cancelPaypalSubscription } from "@/lib/payments/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/subscription/manage — the member's own memberships.
 *
 * `managedBy` replaces the old Stripe-only flag: a member paying by PayPal has
 * a provider-side subscription we can genuinely cancel for them, while an
 * M-Pesa member is billed a period at a time and cancels locally. The UI needs
 * to know which, so it does not offer "cancel at PayPal" to someone who has no
 * PayPal subscription.
 */
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
    providers: paymentProviders().map((p) => ({
      id: p.id,
      name: p.name,
      method: p.method,
      currency: p.currency,
      configured: p.configured,
    })),
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      status: s.status,
      billingCycle: s.billingCycle,
      currentPeriodStart: s.currentPeriodStart,
      currentPeriodEnd: s.currentPeriodEnd,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      usageThisPeriod: s.usageThisPeriod,
      provider: s.provider,
      providerSubscriptionId: s.providerSubscriptionId,
      lastPaymentRef: s.lastPaymentRef,
      lastPaymentAt: s.lastPaymentAt,
      payerPhone: s.payerPhone,
      /** True only when the rail itself has a subscription we can manage. */
      managedByProvider: Boolean(s.providerSubscriptionId),
      plan: {
        id: s.plan.id,
        name: s.plan.name,
        displayName: s.plan.displayName,
        tier: s.plan.tier,
        audience: s.plan.audience,
        priceMonthly: s.plan.priceMonthly,
        priceYearly: s.plan.priceYearly,
        currency: s.plan.currency,
        features: JSON.parse(s.plan.features),
        limits: JSON.parse(s.plan.limits),
      },
    })),
  });
}

/**
 * POST /api/subscription/manage
 *   subscribe(planId, billingCycle, provider, phone?) — free plans are granted
 *     locally; paid plans start a rail and return what the UI needs next (an
 *     M-Pesa prompt to wait on, or a PayPal page to navigate to).
 *   cancel(subscriptionId) — next-cycle cancellation, propagated to the rail.
 *   reactivate(subscriptionId) — un-cancel before the period end.
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
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

async function subscribe(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!body.planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId as string } });
  if (!plan || !plan.isActive) {
    return NextResponse.json({ error: "Plan not found or inactive" }, { status: 404 });
  }

  const cycle = normalizeCycle(body.billingCycle);
  const now = new Date();

  const existing = await prisma.userSubscription.findUnique({
    where: { userId_planId: { userId, planId: plan.id } },
  });
  if (existing && (existing.status === "active" || existing.status === "trialing")) {
    return NextResponse.json({ error: "Already subscribed to this plan" }, { status: 409 });
  }

  // Free tiers never touch a payment rail.
  const free = plan.tier === "free" || (plan.priceMonthly === 0 && plan.priceYearly === 0);
  if (free) {
    const periodEnd = periodWindow(cycle, now).end;
    const sub = await prisma.userSubscription.upsert({
      where: { userId_planId: { userId, planId: plan.id } },
      update: {
        status: "active",
        billingCycle: cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        provider: "manual",
        usageThisPeriod: 0,
        updatedAt: now,
      },
      create: {
        userId,
        planId: plan.id,
        status: "active",
        billingCycle: cycle,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
        provider: "manual",
        usageThisPeriod: 0,
        createdAt: now,
        updatedAt: now,
      },
    });
    return NextResponse.json({ ok: true, free: true, subscription: { id: sub.id, status: sub.status } });
  }

  if (!anyPaymentProviderConfigured()) {
    return NextResponse.json(
      {
        error:
          "Payments aren't configured yet. Add the Safaricom Daraja or PayPal credentials to enable paid plans.",
        code: "PAYMENTS_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  // Which rail? An explicit choice wins; otherwise the first configured one.
  const requested = typeof body.provider === "string" ? body.provider : "";
  const provider = (requested ||
    paymentProviders().find((p) => p.configured)?.id ||
    "") as PaymentProviderId;

  if (!providerConfigured(provider)) {
    return NextResponse.json(
      { error: `${provider || "That"} payments are not enabled yet.`, code: "PROVIDER_UNAVAILABLE" },
      { status: 503 }
    );
  }

  try {
    const result = await startCheckout({
      userId,
      plan: {
        id: plan.id,
        name: plan.name,
        displayName: plan.displayName,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        currency: plan.currency,
        paypalPlanMonthlyId: plan.paypalPlanMonthlyId,
        paypalPlanYearlyId: plan.paypalPlanYearlyId,
      },
      cycle,
      provider,
      phone: typeof body.phone === "string" ? body.phone : null,
    });

    return NextResponse.json({ ok: true, free: false, ...result });
  } catch (err) {
    const status = err instanceof PaymentProviderError ? 502 : 500;
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Could not start the payment.",
        code: err instanceof PaymentProviderError ? "PROVIDER_ERROR" : "CHECKOUT_FAILED",
        provider,
      },
      { status }
    );
  }
}

async function cancel(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!body.subscriptionId) {
    return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
  }

  const sub = await prisma.userSubscription.findFirst({
    where: { id: body.subscriptionId as string, userId },
  });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  // A PayPal subscription keeps billing until PayPal is told to stop. Recording
  // a local cancellation while PayPal keeps charging is the worst failure here,
  // so the remote call must succeed (or determine it is already cancelled)
  // before we write anything.
  if (sub.provider === "paypal" && sub.providerSubscriptionId) {
    const remote = await cancelPaypalSubscription(sub.providerSubscriptionId, "Member cancelled from settings");
    if (!remote.ok) {
      return NextResponse.json(
        { error: `PayPal couldn't schedule the cancellation: ${remote.reason}` },
        { status: 502 }
      );
    }
  }

  const updated = await prisma.userSubscription.update({
    where: { id: sub.id },
    data: {
      cancelAtPeriodEnd: true,
      // M-Pesa has no renewer to stop, so cancelling a one-off period is final
      // at period end rather than a status change today.
      updatedAt: new Date(),
    },
  });

  return NextResponse.json({
    ok: true,
    subscription: {
      id: updated.id,
      cancelAtPeriodEnd: updated.cancelAtPeriodEnd,
      accessUntil: updated.currentPeriodEnd,
    },
  });
}

async function reactivate(userId: string, body: Record<string, unknown>): Promise<NextResponse> {
  if (!body.subscriptionId) {
    return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
  }

  const sub = await prisma.userSubscription.findFirst({
    where: { id: body.subscriptionId as string, userId },
  });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  // Reactivating means the window is still open. Once it lapsed there is nothing
  // to resume — the member has to buy a new period (and for PayPal, re-approve).
  if (sub.currentPeriodEnd.getTime() < Date.now()) {
    return NextResponse.json(
      { error: "That membership has already lapsed — start a new one to continue.", code: "PERIOD_LAPSED" },
      { status: 409 }
    );
  }

  const updated = await prisma.userSubscription.update({
    where: { id: sub.id },
    data: { cancelAtPeriodEnd: false, status: "active", updatedAt: new Date() },
  });

  return NextResponse.json({ ok: true, subscription: { id: updated.id, status: updated.status } });
}
