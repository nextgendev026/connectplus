import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { isUniqueViolation } from "@/lib/payments";
import {
  getSubscription,
  mapPaypalSubscriptionStatus,
  paypalWebhookHeaders,
  verifyWebhook,
} from "@/lib/payments/paypal";
import { findIntent, markIntent, settleIntent } from "@/lib/payments/fulfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("payments");

/**
 * POST /api/payments/paypal/webhook
 *
 * The authority for PayPal money. The browser return trip is only a courtesy —
 * a member can close the tab between PayPal's approval and our redirect, and on
 * a slow connection they usually do — so the subscription is created here, by a
 * notification PayPal signed, and nowhere else.
 *
 * Three things make this safe to expose:
 *
 *   1. **Signature verification through PayPal.** No `PAYPAL_WEBHOOK_ID` means
 *      no verification, and an unverified webhook is just an anonymous request
 *      asking to be given a paid plan: we answer 503 and never look at the body.
 *   2. **Idempotency.** The event id is claimed before the handler runs, so a
 *      redelivery (PayPal retries for days) is a no-op.
 *   3. **Our reference, not theirs.** Every branch resolves the `PaymentIntent`
 *      by the `custom_id` we set at creation, so a webhook for someone else's
 *      order cannot land on this member.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();

  let event: {
    id?: string;
    event_type?: string;
    resource?: Record<string, unknown>;
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!event.event_type) {
    return NextResponse.json({ error: "Missing event_type" }, { status: 400 });
  }

  const headers = paypalWebhookHeaders(request);
  if (!headers) {
    log.warn("paypal webhook without transmission headers", { eventType: event.event_type });
    return NextResponse.json({ error: "Missing verification headers" }, { status: 400 });
  }

  const verification = await verifyWebhook(headers, event).catch((err) => ({
    verified: false,
    reason: err instanceof Error ? err.message : String(err),
  }));
  if (!verification.verified) {
    log.error("paypal webhook signature rejected", {
      eventType: event.event_type,
      eventId: event.id,
      reason: verification.reason,
    });
    return NextResponse.json({ error: "Signature verification failed" }, { status: 503 });
  }

  const eventId = `paypal:${event.id ?? `${event.event_type}:${headers.transmissionId}`}`;
  try {
    await prisma.paymentEvent.create({
      data: { eventId, provider: "paypal", type: event.event_type },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ received: true, duplicate: true });
    log.error("paypal webhook ledger write failed", { eventId, error: String(err) });
    return NextResponse.json({ error: "Could not record event" }, { status: 500 });
  }

  try {
    await handleEvent(event.event_type, event.resource ?? {});
    return NextResponse.json({ received: true });
  } catch (err) {
    // Release the claim so PayPal's retry reprocesses instead of losing the event.
    await prisma.paymentEvent.deleteMany({ where: { eventId } }).catch(() => {});
    log.error("paypal webhook handler failed", { eventId, eventType: event.event_type, error: String(err) });
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

async function handleEvent(type: string, resource: Record<string, unknown>): Promise<void> {
  switch (type) {
    /* ── one-off period (Orders v2) ─────────────────────────────── */

    case "PAYMENT.CAPTURE.COMPLETED": {
      const captureId = str(resource.id);
      const reference = str(resource.custom_id);
      const amount = str((resource.amount as { value?: string } | undefined)?.value);
      await settleByReference(reference, {
        receipt: captureId,
        raw: resource,
        amount: amount ? Number(amount) : null,
      });
      break;
    }

    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.REVERSED":
    case "PAYMENT.CAPTURE.REFUNDED": {
      const reference = str(resource.custom_id);
      const intent = await findIntent({ reference });
      if (!intent) break;
      await markIntent(intent.id, {
        status: type === "PAYMENT.CAPTURE.REFUNDED" ? "expired" : "failed",
        failureReason: `PayPal reported ${type.replace(/^PAYMENT\.CAPTURE\./, "").toLowerCase()}.`,
        raw: resource,
      });
      break;
    }

    /* ── recurring (Subscriptions v1) ───────────────────────────── */

    case "BILLING.SUBSCRIPTION.ACTIVATED":
    case "BILLING.SUBSCRIPTION.UPDATED": {
      const subscriptionId = str(resource.id);
      const reference = str(resource.custom_id);
      const nextBilling = str(
        (resource.billing_info as { next_billing_time?: string } | undefined)?.next_billing_time
      );
      const subscriber = (resource.subscriber as { email_address?: string } | undefined)?.email_address ?? null;

      await settleByReference(reference, {
        receipt: subscriptionId ? `paypal-sub:${subscriptionId}` : null,
        providerSubscriptionId: subscriptionId,
        providerCustomerId: subscriber,
        periodEnd: nextBilling ? new Date(nextBilling) : null,
        raw: resource,
      });
      break;
    }

    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED":
    case "BILLING.SUBSCRIPTION.SUSPENDED": {
      const subscriptionId = str(resource.id);
      if (!subscriptionId) break;
      const status = mapPaypalSubscriptionStatus(String(resource.status ?? "CANCELLED"));
      await prisma.userSubscription.updateMany({
        where: { providerSubscriptionId: subscriptionId },
        // A suspension is recoverable (a failed card), so the member keeps their
        // window and is marked past_due; a cancellation ends it.
        data: {
          status,
          ...(status === "cancelled" ? { cancelAtPeriodEnd: false } : {}),
          updatedAt: new Date(),
        },
      });
      break;
    }

    /* ── recurring charges (v1 sale events, delivered for subscriptions) ── */

    case "PAYMENT.SALE.COMPLETED": {
      const subscriptionId = str(resource.billing_agreement_id);
      if (!subscriptionId) break;
      const saleId = str(resource.id);
      // Reconcile the window from PayPal rather than trusting the sale payload.
      const remote = await getSubscription(subscriptionId).catch(() => null);
      const sub = await prisma.userSubscription.findFirst({
        where: { providerSubscriptionId: subscriptionId },
      });
      if (!sub) break;
      await prisma.userSubscription.update({
        where: { id: sub.id },
        data: {
          status: "active",
          ...(saleId ? { lastPaymentRef: saleId, lastPaymentAt: new Date() } : {}),
          ...(remote?.nextBillingTime ? { currentPeriodEnd: new Date(remote.nextBillingTime) } : {}),
          updatedAt: new Date(),
        },
      });
      break;
    }

    /* ── order lifecycle ────────────────────────────────────────── */

    case "CHECKOUT.ORDER.APPROVED": {
      // Nothing to grant: approval is not payment. The capture happens on the
      // return trip (or arrives as PAYMENT.CAPTURE.COMPLETED).
      break;
    }

    default:
      log.info("paypal webhook ignored", { type });
      break;
  }
}

/**
 * Resolve the intent by our own reference and settle it.
 *
 * A webhook whose reference matches no intent is a real signal — a payment for
 * a plan that no longer exists, or a forged `custom_id` — so it is logged with
 * the receipt attached and left alone.
 */
async function settleByReference(
  reference: string | null,
  data: {
    receipt?: string | null;
    providerSubscriptionId?: string | null;
    providerCustomerId?: string | null;
    periodEnd?: Date | null;
    amount?: number | null;
    raw?: unknown;
  }
): Promise<void> {
  if (!reference) {
    log.warn("paypal webhook carried no custom_id — cannot attribute the payment", { raw: data.raw });
    return;
  }

  const intent = await findIntent({ reference });
  if (!intent) {
    log.warn("paypal webhook for an unknown reference", { reference, receipt: data.receipt });
    return;
  }

  if (data.amount != null && Math.abs(data.amount - intent.amount) > 0.5) {
    log.error("paypal amount mismatch — refusing to grant", {
      intentId: intent.id,
      expected: intent.amount,
      received: data.amount,
    });
    await markIntent(intent.id, {
      status: "failed",
      failureReason: `Amount mismatch: expected ${intent.amount} ${intent.currency}, received ${data.amount}.`,
      raw: data.raw,
    });
    return;
  }

  await settleIntent(intent.id, {
    receipt: data.receipt ?? null,
    providerSubscriptionId: data.providerSubscriptionId ?? null,
    providerCustomerId: data.providerCustomerId ?? null,
    periodEnd: data.periodEnd ?? null,
    raw: data.raw,
  });
}
