/**
 * Starting a checkout — one function per rail, one shared intent.
 *
 * The order is always the same:
 *
 *   1. Write the `PaymentIntent` (what is being bought, by whom, for how much).
 *   2. Ask the provider to start the payment.
 *   3. Record the provider's handle on the intent.
 *
 * Doing (1) first is what makes an asynchronous rail safe. If step 2 times out
 * we still know exactly what was attempted, and when the callback eventually
 * arrives it has something to land on.
 */

import { prisma } from "@/lib/prisma";
import {
  appUrl,
  newReference,
  settlementAmount,
  type PaymentProviderId,
  PaymentProviderError,
} from "./index";
import { createIntent, markIntent } from "./fulfill";
import { stkPush } from "./daraja";
import { createOrder, createSubscription } from "./paypal";

export interface StartCheckoutInput {
  userId: string;
  plan: {
    id: string;
    name: string;
    displayName: string;
    priceMonthly: number;
    priceYearly: number;
    currency: string;
    paypalPlanMonthlyId: string | null;
    paypalPlanYearlyId: string | null;
  };
  cycle: "monthly" | "yearly";
  provider: PaymentProviderId;
  /** Required for Daraja: the MSISDN the STK prompt goes to. */
  phone?: string | null;
}

export type StartCheckoutResult =
  | {
      provider: "daraja";
      intentId: string;
      reference: string;
      /** Safaricom's own wording, shown verbatim under the PIN spinner. */
      message: string;
      checkoutRequestId: string;
      amount: number;
      currency: string;
      phone: string;
    }
  | {
      provider: "paypal";
      intentId: string;
      reference: string;
      /** Hosted approval page — the browser is navigated here. */
      redirectUrl: string;
      mode: "subscription" | "order";
      amount: number;
      currency: string;
    };

export async function startCheckout(input: StartCheckoutInput): Promise<StartCheckoutResult> {
  const { plan, cycle, provider } = input;
  const priced = settlementAmount(plan, cycle, provider);
  const reference = newReference(provider);

  const intent = await createIntent({
    userId: input.userId,
    planId: plan.id,
    cycle,
    provider,
    reference,
    amount: priced.amount,
    currency: priced.currency,
    listAmount: priced.listAmount,
    listCurrency: priced.listCurrency,
  });

  try {
    if (provider === "daraja") {
      if (!input.phone) {
        throw new PaymentProviderError("daraja", "Enter the M-Pesa number to bill.");
      }
      const push = await stkPush({
        phone: input.phone,
        amount: priced.amount,
        reference,
        description: `${plan.displayName} (${cycle})`,
      });
      await markIntent(intent.id, {
        status: "processing",
        providerRequestId: push.checkoutRequestId,
        phone: input.phone,
        raw: push,
      });
      return {
        provider: "daraja",
        intentId: intent.id,
        reference,
        message: push.customerMessage,
        checkoutRequestId: push.checkoutRequestId,
        amount: priced.amount,
        currency: priced.currency,
        phone: input.phone,
      };
    }

    // PayPal. A plan with a PayPal plan id gets a real recurring subscription;
    // without one it is billed a single period and we renew from the period end.
    const returnUrl = `${appUrl()}/api/payments/paypal/return`;
    const cancelUrl = `${appUrl()}/pricing?checkout=cancelled`;
    const paypalPlanId =
      cycle === "yearly" ? plan.paypalPlanYearlyId : plan.paypalPlanMonthlyId;

    if (paypalPlanId) {
      const sub = await createSubscription({
        planId: paypalPlanId,
        reference,
        returnUrl,
        cancelUrl,
      });
      await markIntent(intent.id, {
        status: "processing",
        providerOrderId: sub.subscriptionId,
        checkoutUrl: sub.approveUrl,
        raw: sub,
      });
      return {
        provider: "paypal",
        intentId: intent.id,
        reference,
        redirectUrl: sub.approveUrl,
        mode: "subscription",
        amount: priced.amount,
        currency: priced.currency,
      };
    }

    const order = await createOrder({
      reference,
      amount: priced.amount,
      currency: priced.currency,
      description: `connectPlus ${plan.displayName} — ${cycle}`,
      returnUrl,
      cancelUrl,
    });
    await markIntent(intent.id, {
      status: "processing",
      providerOrderId: order.orderId,
      checkoutUrl: order.approveUrl,
      raw: order,
    });
    return {
      provider: "paypal",
      intentId: intent.id,
      reference,
      redirectUrl: order.approveUrl,
      mode: "order",
      amount: priced.amount,
      currency: priced.currency,
    };
  } catch (err) {
    // Never leave a live intent behind a checkout that never started: it would
    // show up as an abandoned payment in the console instead of a plain failure.
    await markIntent(intent.id, {
      status: "failed",
      failureReason: err instanceof Error ? err.message : String(err),
      raw: err instanceof PaymentProviderError ? err.detail ?? err.message : String(err),
    }).catch(() => {});
    throw err;
  }
}

/** Latest intent for a (user, plan) pair — what the checkout UI polls. */
export async function latestIntentFor(userId: string, planId: string) {
  return prisma.paymentIntent.findFirst({
    where: { userId, planId },
    orderBy: { createdAt: "desc" },
  });
}
