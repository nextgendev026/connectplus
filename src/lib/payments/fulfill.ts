/**
 * Fulfilment — the one path that turns a settled payment into a membership.
 *
 * Both rails end up here, and nothing else is allowed to write a paid
 * subscription. That is deliberate: whether the money arrived as an M-Pesa STK
 * callback or a PayPal webhook, the entitlement must be applied by identical
 * code, or the two rails drift and "PayPal members get an extra cycle" becomes
 * a support ticket nobody can reproduce.
 *
 * Everything here is safe to call twice. PayPal redelivers webhooks until it
 * gets a 2xx, Safaricom can repeat an STK callback, and a member may refresh the
 * return page — all three land on the same idempotent upsert.
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { periodWindow, type PaymentProviderId } from "./index";

const log = createLogger("payments");

export interface GrantInput {
  userId: string;
  planId: string;
  cycle: "monthly" | "yearly";
  provider: PaymentProviderId | "manual";
  /** M-Pesa receipt number or PayPal capture id. */
  receipt?: string | null;
  phone?: string | null;
  providerSubscriptionId?: string | null;
  providerCustomerId?: string | null;
  /** Provider-authoritative window (PayPal reports its own next charge date). */
  periodStart?: Date | null;
  periodEnd?: Date | null;
}

export interface GrantResult {
  subscriptionId: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  /** False when the same payment had already been applied. */
  changed: boolean;
}

/**
 * Apply a settled payment: create the membership or roll its window forward.
 *
 * A renewal extends from the *existing* period end rather than from now, so a
 * member who pays early never loses the days they already bought, and paying
 * late does not silently shorten the year.
 */
export async function grantSubscription(input: GrantInput): Promise<GrantResult> {
  const now = new Date();
  const existing = await prisma.userSubscription.findUnique({
    where: { userId_planId: { userId: input.userId, planId: input.planId } },
  });

  const providerAuthoritative = Boolean(input.periodEnd);
  let start: Date;
  let end: Date;

  if (providerAuthoritative) {
    start = input.periodStart ?? now;
    end = input.periodEnd!;
  } else if (existing && existing.currentPeriodEnd > now && existing.billingCycle === input.cycle) {
    start = existing.currentPeriodEnd;
    end = periodWindow(input.cycle, start).end;
  } else {
    start = now;
    end = periodWindow(input.cycle, now).end;
  }

  // A repeated delivery usually lands inside the same window we just wrote. If
  // the receipt is one we already recorded, this is a replay: acknowledge it
  // without moving the period a second time.
  const replayed =
    Boolean(input.receipt) && existing?.lastPaymentRef === input.receipt && existing?.status === "active";

  if (replayed) {
    return {
      subscriptionId: existing!.id,
      status: existing!.status,
      periodStart: existing!.currentPeriodStart,
      periodEnd: existing!.currentPeriodEnd,
      changed: false,
    };
  }

  const record = {
    status: "active",
    billingCycle: input.cycle,
    currentPeriodStart: start,
    currentPeriodEnd: end,
    cancelAtPeriodEnd: false,
    provider: input.provider,
    providerSubscriptionId: input.providerSubscriptionId ?? existing?.providerSubscriptionId ?? null,
    providerCustomerId: input.providerCustomerId ?? existing?.providerCustomerId ?? null,
    lastPaymentRef: input.receipt ?? existing?.lastPaymentRef ?? null,
    lastPaymentAt: input.receipt ? now : existing?.lastPaymentAt ?? null,
    payerPhone: input.phone ?? existing?.payerPhone ?? null,
    // A brand-new window means a fresh usage allowance; extending inside the
    // same window must NOT hand back quota the member already spent.
    usageThisPeriod: existing && start === existing.currentPeriodStart ? existing.usageThisPeriod : 0,
  };

  const subscription = await prisma.userSubscription.upsert({
    where: { userId_planId: { userId: input.userId, planId: input.planId } },
    update: record,
    create: { userId: input.userId, planId: input.planId, ...record },
  });

  log.info("membership granted", {
    subscriptionId: subscription.id,
    planId: input.planId,
    provider: input.provider,
    cycle: input.cycle,
    periodEnd: end.toISOString(),
  });

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    periodStart: subscription.currentPeriodStart,
    periodEnd: subscription.currentPeriodEnd,
    changed: true,
  };
}

/* ------------------------------------------------------------------ */
/* intents                                                             */
/* ------------------------------------------------------------------ */

export interface CreateIntentInput {
  userId: string;
  planId: string;
  cycle: "monthly" | "yearly";
  provider: PaymentProviderId;
  reference: string;
  amount: number;
  currency: string;
  listAmount: number;
  listCurrency: string;
}

export async function createIntent(input: CreateIntentInput) {
  return prisma.paymentIntent.create({
    data: {
      userId: input.userId,
      planId: input.planId,
      billingCycle: input.cycle,
      provider: input.provider,
      reference: input.reference,
      amount: input.amount,
      currency: input.currency,
      listAmount: input.listAmount,
      listCurrency: input.listCurrency,
      status: "pending",
    },
  });
}

/**
 * Find the intent a provider notification belongs to.
 *
 * Lookup order is the point: our own reference first (both rails echo it back),
 * then the provider's own handle. A notification matching none of these is not
 * evidence of anything and is refused by the caller.
 */
export async function findIntent(query: {
  reference?: string | null;
  providerRequestId?: string | null;
  providerOrderId?: string | null;
}) {
  const { reference, providerRequestId, providerOrderId } = query;
  const clauses = [
    ...(reference ? [{ reference }] : []),
    ...(providerRequestId ? [{ providerRequestId }] : []),
    ...(providerOrderId ? [{ providerOrderId }] : []),
  ];
  if (clauses.length === 0) return null;
  return prisma.paymentIntent.findFirst({ where: { OR: clauses }, orderBy: { createdAt: "desc" } });
}

/** Mark an intent settled and grant the plan it was created for. */
export async function settleIntent(
  intentId: string,
  data: {
    receipt?: string | null;
    phone?: string | null;
    providerSubscriptionId?: string | null;
    providerCustomerId?: string | null;
    providerOrderId?: string | null;
    periodStart?: Date | null;
    periodEnd?: Date | null;
    raw?: unknown;
  }
): Promise<GrantResult | null> {
  const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
  if (!intent) return null;

  // Already settled. This is the normal case, not an error: the status poll can
  // settle a Daraja payment seconds before the callback arrives, and the callback
  // then carries the receipt the poll could not have. Backfill it and stop —
  // granting again would extend the period a second time for one payment.
  if (intent.status === "succeeded") {
    if ((data.receipt && !intent.providerReceipt) || data.providerSubscriptionId) {
      await prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          providerReceipt: data.receipt ?? intent.providerReceipt,
          payerPhone: data.phone ?? intent.payerPhone,
          settledAt: intent.settledAt ?? new Date(),
          metadata: data.raw !== undefined ? safeJson(data.raw) : intent.metadata,
          updatedAt: new Date(),
        },
      });
      // Keep the membership's audit fields in step with the receipt we just
      // learned about, without touching its window.
      if (data.receipt) {
        await prisma.userSubscription.updateMany({
          where: { userId: intent.userId, planId: intent.planId },
          data: { lastPaymentRef: data.receipt, lastPaymentAt: intent.settledAt ?? new Date() },
        });
      }
    }
    const existing = await prisma.userSubscription.findUnique({
      where: { userId_planId: { userId: intent.userId, planId: intent.planId } },
    });
    return {
      subscriptionId: existing?.id ?? "",
      status: existing?.status ?? "active",
      periodStart: existing?.currentPeriodStart ?? new Date(),
      periodEnd: existing?.currentPeriodEnd ?? new Date(),
      changed: false,
    };
  }

  const cycle = intent.billingCycle === "yearly" ? "yearly" : "monthly";

  const grant = await grantSubscription({
    userId: intent.userId,
    planId: intent.planId,
    cycle,
    provider: intent.provider === "daraja" ? "daraja" : "paypal",
    receipt: data.receipt ?? null,
    phone: data.phone ?? null,
    providerSubscriptionId: data.providerSubscriptionId ?? null,
    providerCustomerId: data.providerCustomerId ?? null,
    periodStart: data.periodStart ?? null,
    periodEnd: data.periodEnd ?? null,
  });

  await prisma.paymentIntent.update({
    where: { id: intent.id },
    data: {
      status: "succeeded",
      providerReceipt: data.receipt ?? intent.providerReceipt,
      payerPhone: data.phone ?? intent.payerPhone,
      providerOrderId: data.providerOrderId ?? intent.providerOrderId,
      metadata: data.raw !== undefined ? safeJson(data.raw) : intent.metadata,
      settledAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return grant;
}

export async function markIntent(
  intentId: string,
  data: {
    status: "pending" | "processing" | "succeeded" | "failed" | "cancelled" | "expired";
    failureReason?: string | null;
    providerOrderId?: string | null;
    providerRequestId?: string | null;
    checkoutUrl?: string | null;
    phone?: string | null;
    raw?: unknown;
  }
) {
  return prisma.paymentIntent.update({
    where: { id: intentId },
    data: {
      status: data.status,
      ...(data.failureReason !== undefined ? { failureReason: data.failureReason } : {}),
      ...(data.providerOrderId ? { providerOrderId: data.providerOrderId } : {}),
      ...(data.providerRequestId ? { providerRequestId: data.providerRequestId } : {}),
      ...(data.checkoutUrl ? { checkoutUrl: data.checkoutUrl } : {}),
      ...(data.phone ? { payerPhone: data.phone } : {}),
      ...(data.raw !== undefined ? { metadata: safeJson(data.raw) } : {}),
      ...(data.status === "failed" || data.status === "cancelled" || data.status === "expired"
        ? { settledAt: new Date() }
        : {}),
      updatedAt: new Date(),
    },
  });
}

/** Map a Daraja ResultCode onto a terminal intent status. */
export function intentStatusForResultCode(resultCode: number): "succeeded" | "cancelled" | "failed" {
  if (resultCode === 0) return "succeeded";
  // 1032 = the payer cancelled the prompt on their handset; 1037 = no response
  // (timeout); 2001 = wrong PIN. Cancellations are user choices, not failures.
  if (resultCode === 1032 || resultCode === 1037) return "cancelled";
  return "failed";
}

/** Human-readable Daraja failure reasons for the console and the UI. */
export function darajaResultMessage(resultCode: number, resultDesc?: string): string {
  switch (resultCode) {
    case 0:
      return "Payment received";
    case 1:
      return "Insufficient M-Pesa balance for this payment.";
    case 1032:
      return "The M-Pesa prompt was cancelled on the phone.";
    case 1037:
      return "No response to the M-Pesa prompt — it timed out. Try again or dial *334#.";
    case 2001:
      return "Wrong M-Pesa PIN. The prompt has been cancelled.";
    case 1025:
      return "A request with the same reference is already being processed.";
    case 9999:
      return "Safaricom reported a system error. Please try again in a moment.";
    default:
      return resultDesc || "The M-Pesa payment did not complete.";
  }
}

function safeJson(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    // Provider payloads can be large; the intent column is for audit, not replay.
    return json.length > 8000 ? `${json.slice(0, 8000)}…` : json;
  } catch {
    return "{}";
  }
}
