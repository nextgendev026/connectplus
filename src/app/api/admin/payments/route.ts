import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { paymentProviders, settlementAmount, type PaymentProviderId } from "@/lib/payments";
import { expireLapsedSubscriptions, paymentPipelineHealth, reconcileSubscription } from "@/lib/payments/lifecycle";
import { grantSubscription } from "@/lib/payments/fulfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("payments");

function isAdmin(role?: string) {
  return role === "SUPER_ADMIN" || role === "ADMIN";
}

/**
 * GET /api/admin/payments
 *
 * The whole money picture in one read: which rails are live and what they are
 * still missing, what has been attempted, what settled, what failed and why, and
 * every inbound notification we accepted. Credentials are reported by *name*
 * only — the console shows what to paste into the environment, never a value.
 */
export async function GET() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [
    intents,
    events,
    byProvider,
    succeeded30,
    failed24,
    health,
    plans,
    subscriptionProviders,
  ] = await Promise.all([
    prisma.paymentIntent.findMany({
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.paymentEvent.findMany({ orderBy: { handledAt: "desc" }, take: 40 }),
    prisma.userSubscription.groupBy({
      by: ["provider", "status"],
      _count: { id: true },
    }),
    prisma.paymentIntent.findMany({
      where: { status: "succeeded", settledAt: { gte: since30 } },
      select: {
        amount: true,
        currency: true,
        provider: true,
        billingCycle: true,
        planId: true,
        userId: true,
        settledAt: true,
      },
    }),
    prisma.paymentIntent.count({ where: { status: "failed", createdAt: { gte: since24 } } }),
    paymentPipelineHealth(),
    prisma.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: [{ audience: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.userSubscription.count(),
  ]);

  // Revenue is reported per currency, never summed across them: adding KES to
  // USD produces a number that means nothing.
  const revenue: Record<string, { total: number; count: number; byProvider: Record<string, number> }> = {};
  for (const row of succeeded30) {
    const bucket = (revenue[row.currency] ??= { total: 0, count: 0, byProvider: {} });
    bucket.total = Math.round((bucket.total + row.amount) * 100) / 100;
    bucket.count += 1;
    bucket.byProvider[row.provider] = Math.round(((bucket.byProvider[row.provider] ?? 0) + row.amount) * 100) / 100;
  }

  const userMap = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: [...new Set(intents.map((i) => i.userId))] } },
        select: { id: true, name: true, username: true, email: true },
      })
    ).map((u) => [u.id, u])
  );

  const planMap = new Map(plans.map((p) => [p.id, p]));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    providers: paymentProviders(),
    health: { ...health, failedToday: failed24, subscriptionRows: subscriptionProviders },
    // What each rail would charge right now, so an admin can see the KES price a
    // member will actually be prompted for.
    pricing: plans.map((plan) => ({
      planId: plan.id,
      displayName: plan.displayName,
      audience: plan.audience,
      listCurrency: plan.currency,
      priceMonthly: plan.priceMonthly,
      priceYearly: plan.priceYearly,
      paypalPlanMonthlyId: plan.paypalPlanMonthlyId,
      paypalPlanYearlyId: plan.paypalPlanYearlyId,
      settlement: {
        daraja: settlementAmount(plan, "monthly", "daraja"),
        daraja_yearly: settlementAmount(plan, "yearly", "daraja"),
        paypal: settlementAmount(plan, "monthly", "paypal"),
        paypal_yearly: settlementAmount(plan, "yearly", "paypal"),
      },
    })),
    revenue,
    subscriptionsByProvider: byProvider.map((row) => ({
      provider: row.provider,
      status: row.status,
      count: row._count.id,
    })),
    intents: intents.map((i) => ({
      id: i.id,
      reference: i.reference,
      provider: i.provider,
      status: i.status,
      amount: i.amount,
      currency: i.currency,
      listAmount: i.listAmount,
      listCurrency: i.listCurrency,
      billingCycle: i.billingCycle,
      createdAt: i.createdAt,
      settledAt: i.settledAt,
      providerReceipt: i.providerReceipt,
      providerOrderId: i.providerOrderId,
      providerRequestId: i.providerRequestId,
      payerPhone: i.payerPhone,
      failureReason: i.failureReason,
      plan: planMap.get(i.planId)?.displayName ?? i.planId,
      user: userMap.get(i.userId) ?? { id: i.userId, name: null, username: null, email: null },
    })),
    events: events.map((e) => ({
      id: e.id,
      eventId: e.eventId,
      provider: e.provider,
      type: e.type,
      handledAt: e.handledAt,
    })),
  });
}

/**
 * POST /api/admin/payments — the operator's repair and adjustment tools.
 *
 * Every action here exists because the alternative is editing the database by
 * hand: a webhook that never arrived, a member paid in cash/bank transfer, a
 * charge that was refunded outside the app.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const actorId = (session?.user as { id?: string } | undefined)?.id;
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  if (!body?.action) return NextResponse.json({ error: "action is required" }, { status: 400 });

  switch (body.action) {
    case "reconcile": {
      if (!body.subscriptionId) {
        return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
      }
      const result = await reconcileSubscription(body.subscriptionId as string);
      return NextResponse.json(result, { status: result.ok ? 200 : 502 });
    }

    case "expire-lapsed": {
      const result = await expireLapsedSubscriptions();
      return NextResponse.json({ ok: true, ...result });
    }

    case "grant": {
      const userId = await resolveUser(body);
      if (!userId) return NextResponse.json({ error: "A user (id or email) is required" }, { status: 400 });
      if (!body.planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: body.planId as string } });
      if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

      const cycle = body.billingCycle === "yearly" ? "yearly" : "monthly";
      // A comp is recorded as `manual` with the operator named in the receipt
      // field, so the console can always answer "who gave this away?".
      const grant = await grantSubscription({
        userId,
        planId: plan.id,
        cycle,
        provider: "manual",
        receipt: `manual:${actorId ?? "admin"}`,
      });
      log.info("plan granted manually", { userId, planId: plan.id, by: actorId });
      return NextResponse.json({ ok: true, ...grant });
    }

    case "revoke": {
      if (!body.subscriptionId) {
        return NextResponse.json({ error: "subscriptionId is required" }, { status: 400 });
      }
      const updated = await prisma.userSubscription
        .update({
          where: { id: body.subscriptionId as string },
          data: { status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() },
        })
        .catch(() => null);
      if (!updated) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
      log.warn("membership revoked by admin", { subscriptionId: updated.id, by: actorId });
      return NextResponse.json({ ok: true, subscriptionId: updated.id });
    }

    case "mark-refunded": {
      if (!body.intentId) return NextResponse.json({ error: "intentId is required" }, { status: 400 });
      const intent = await prisma.paymentIntent
        .update({
          where: { id: body.intentId as string },
          data: {
            status: "expired",
            failureReason: `Marked refunded by ${actorId ?? "admin"}${body.note ? `: ${body.note}` : ""}`,
            settledAt: new Date(),
            updatedAt: new Date(),
          },
        })
        .catch(() => null);
      if (!intent) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

      // Revoking the membership is the point of marking a refund: leaving the
      // plan active would hand over access we already gave the money back for.
      await prisma.userSubscription.updateMany({
        where: { userId: intent.userId, planId: intent.planId, provider: intent.provider },
        data: { status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() },
      });
      log.warn("payment marked refunded", { intentId: intent.id, by: actorId });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}

async function resolveUser(body: Record<string, unknown>): Promise<string | null> {
  const id = typeof body.userId === "string" ? body.userId.trim() : "";
  if (id) return id;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return user?.id ?? null;
}

/** Payment rails are the one integration an admin should be able to test live. */
export async function PATCH(request: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!isAdmin(role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const provider = body?.provider as PaymentProviderId | undefined;
  if (provider !== "daraja" && provider !== "paypal") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  // A credentials probe: proving the keys work is the whole point, and a test
  // charge would be a real charge on someone's handset.
  try {
    if (provider === "daraja") {
      const { darajaAccessToken } = await import("@/lib/payments/daraja");
      await darajaAccessToken(true);
      return NextResponse.json({ ok: true, detail: "Safaricom accepted the Daraja credentials" });
    }
    const { paypalAccessToken } = await import("@/lib/payments/paypal");
    await paypalAccessToken(true);
    return NextResponse.json({ ok: true, detail: "PayPal accepted the API credentials" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, detail: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
