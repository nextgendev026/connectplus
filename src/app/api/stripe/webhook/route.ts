import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, stripeConfigured, periodWindow } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/**
 * POST /api/stripe/webhook
 *
 * Idempotency model: every delivery is recorded in StripeEvent.first, then the
 * handler runs. If the handler throws we DELETE that ledger row so Stripe's
 * automatic retry can reprocess the event instead of losing it.
 *
 * The Stripe dashboard must point here with the STRIPE_WEBHOOK_SECRET from
 * .env:  https://<app>/api/stripe/webhook   →   subscription events.
 */
export async function POST(request: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Billing not configured" }, { status: 501 });
  }
  const stripe = getStripe()!;
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  const seen = await prisma.stripeEvent.findUnique({ where: { eventId: event.id } });
  if (seen) return NextResponse.json({ received: true, duplicate: true });

  await prisma.stripeEvent.create({ data: { eventId: event.id, type: event.type } });

  try {
    await handleEvent(stripe, event);
    return NextResponse.json({ received: true });
  } catch (err) {
    // Roll the ledger row back so Stripe's retry can reprocess cleanly.
    await prisma.stripeEvent.delete({ where: { eventId: event.id } }).catch(() => {});
    console.error("Webhook handler failed:", event.type, event.id, err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}

function mapStatus(status: Stripe.Subscription.Status): string {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "cancelled";
}

/**
 * Current billing window for a subscription. This API generation exposes the
 * period as `billing_cycle_anchor` (start) + `billing_schedules[].bill_until`
 * (end) instead of `current_period_start/end`; falls back to a cycle derived
 * window so the webhook never needs to know our billing-cycle metadata.
 */
function subscriptionPeriod(
  sub: Stripe.Subscription | null | undefined,
  fallbackCycle: "monthly" | "yearly"
): { start: Date; end: Date } {
  if (sub) {
    const startSec = sub.billing_cycle_anchor ?? sub.start_date ?? null;
    const endSec =
      sub.billing_schedules?.[0]?.bill_until?.timestamp ??
      (sub.billing_schedules?.[0]?.bill_until as unknown as
        | { timestamp?: number }
        | undefined)?.timestamp ??
      null;
    if (startSec || endSec) {
      const start = startSec ? new Date(startSec * 1000) : new Date();
      const end = endSec ? new Date(endSec * 1000) : periodWindow(fallbackCycle, start).end;
      return { start, end };
    }
  }
  return periodWindow(fallbackCycle, new Date());
}

/** Link an invoice back to its originating subscription. */
function invoiceSubscriptionId(inv: Stripe.Invoice): string | undefined {
  const top = inv as unknown as { subscription?: string | null };
  if (top.subscription) return top.subscription;
  const line = inv.lines.data[0];
  const parent = line?.parent as unknown as
    | { subscription_details?: { subscription?: string | null } }
    | undefined;
  return parent?.subscription_details?.subscription ?? undefined;
}

async function findPlanByPrice(priceId?: string | null) {
  if (!priceId) return null;
  return prisma.subscriptionPlan.findFirst({
    where: { OR: [{ stripePriceMonthlyId: priceId }, { stripePriceYearlyId: priceId }] },
  });
}

async function handleEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  const { data } = event;

  switch (event.type) {
    case "checkout.session.completed": {
      const obj = data.object as Stripe.Checkout.Session;
      const userId = obj.metadata?.userId ?? obj.client_reference_id;
      const planId = obj.metadata?.planId;
      if (!userId || !planId) return; // metadata is always set by our checkout

      const subscriptionId =
        typeof obj.subscription === "string" ? obj.subscription : obj.subscription?.id;
      const customerId = typeof obj.customer === "string" ? obj.customer : obj.customer?.id;

      const stripeSub = subscriptionId
        ? await stripe.subscriptions.retrieve(subscriptionId)
        : null;
      const billingCycle = obj.metadata?.billingCycle === "yearly" ? "yearly" : "monthly";
      const window = subscriptionPeriod(stripeSub, billingCycle);

      await prisma.userSubscription.upsert({
        where: { userId_planId: { userId, planId } },
        update: {
          status: stripeSub ? mapStatus(stripeSub.status) : "active",
          billingCycle,
          currentPeriodStart: window.start,
          currentPeriodEnd: window.end,
          cancelAtPeriodEnd: stripeSub?.cancel_at_period_end ?? false,
          stripeSubscriptionId: subscriptionId ?? null,
          stripeCustomerId: customerId ?? null,
          usageThisPeriod: 0,
          updatedAt: new Date(),
        },
        create: {
          userId,
          planId,
          status: stripeSub ? mapStatus(stripeSub.status) : "active",
          billingCycle,
          currentPeriodStart: window.start,
          currentPeriodEnd: window.end,
          cancelAtPeriodEnd: stripeSub?.cancel_at_period_end ?? false,
          stripeSubscriptionId: subscriptionId ?? null,
          stripeCustomerId: customerId ?? null,
          usageThisPeriod: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      break;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const obj = data.object as Stripe.Subscription;
      await syncSubscription(obj);
      break;
    }

    case "invoice.paid": {
      const obj = data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(obj);
      if (subscriptionId) {
        await prisma.userSubscription.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: { usageThisPeriod: 0, updatedAt: new Date() },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const obj = data.object as Stripe.Invoice;
      const subscriptionId = invoiceSubscriptionId(obj);
      if (subscriptionId) {
        await prisma.userSubscription.updateMany({
          where: { stripeSubscriptionId: subscriptionId },
          data: { status: "past_due", updatedAt: new Date() },
        });
      }
      break;
    }

    default:
      break; // other events acknowledged but ignored
  }
}

async function syncSubscription(obj: Stripe.Subscription): Promise<void> {
  const subscriptionId = String(obj.id);
  const status = mapStatus(obj.status);
  const billingCycle =
    obj.metadata?.billingCycle === "yearly" ? "yearly" : "monthly";
  const window = subscriptionPeriod(obj, billingCycle);

  let sub = await prisma.userSubscription.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
  });

  // First time we see this Stripe subscription — derive the local plan from
  // checkout metadata when possible, else from the price id.
  if (!sub) {
    const userId = obj.metadata?.userId;
    let planId = obj.metadata?.planId;
    if (!planId) {
      const priceId = obj.items.data[0]?.price?.id;
      const plan = await findPlanByPrice(priceId);
      planId = plan?.id;
    }
    if (userId && planId) {
      sub = await prisma.userSubscription.findUnique({
        where: { userId_planId: { userId, planId } },
      });
      if (sub) {
        await prisma.userSubscription.update({
          where: { id: sub.id },
          data: { stripeSubscriptionId: subscriptionId },
        });
      }
    }
    if (!sub) return; // can't map — swallow, we'll catch it in the portal/GET anyway
  }

  await prisma.userSubscription.update({
    where: { id: sub.id },
    data: {
      status,
      billingCycle,
      currentPeriodStart: window.start,
      currentPeriodEnd: window.end,
      cancelAtPeriodEnd: obj.cancel_at_period_end,
      updatedAt: new Date(),
    },
  });
}