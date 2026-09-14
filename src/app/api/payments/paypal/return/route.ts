import { NextRequest, NextResponse } from "next/server";
import { appUrl } from "@/lib/payments";
import { createLogger } from "@/lib/logger";
import { captureOrder, getSubscription } from "@/lib/payments/paypal";
import { findIntent, settleIntent } from "@/lib/payments/fulfill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("payments");

/**
 * GET /api/payments/paypal/return
 *
 * Where PayPal sends the member back. Two jobs, in this order:
 *
 *   1. **Capture.** With `intent: CAPTURE` the money only moves when this call
 *      runs, and a member who pays and never returns would otherwise leave an
 *      approved-but-uncaptured order. So this route matters for revenue, not
 *      just for UX.
 *   2. **Redirect.** Back into the app with the outcome in the query string.
 *
 * What it deliberately does NOT do is grant anything on the basis of arriving
 * here. A return URL can be typed by anyone; every settlement still goes through
 * `settleIntent`, and the membership's source of truth remains the capture id
 * and the signed webhook.
 *
 * Nothing here fails the member's checkout: if the capture is refused, we send
 * them back to the pricing page with the reason rather than an error page.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("token");
  const subscriptionId = searchParams.get("subscription_id");

  const back = (params: Record<string, string>) => {
    const url = new URL(`${appUrl()}/settings`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    return NextResponse.redirect(url);
  };

  try {
    /* ── recurring: PayPal returns a subscription id ─────────────── */
    if (subscriptionId) {
      const remote = await getSubscription(subscriptionId);
      if (!remote) return back({ checkout: "pending" });

      const intent = await findIntent({ providerOrderId: subscriptionId, reference: remote.reference });
      if (!intent) {
        // The webhook will carry the reference even when the return trip loses
        // it; nothing to do here but wait for it.
        log.warn("paypal subscription return with no matching intent", { subscriptionId });
        return back({ checkout: "pending" });
      }

      if (remote.active || remote.status === "APPROVED") {
        await settleIntent(intent.id, {
          receipt: `paypal-sub:${subscriptionId}`,
          providerSubscriptionId: subscriptionId,
          providerCustomerId: remote.subscriberEmail,
          periodEnd: remote.nextBillingTime ? new Date(remote.nextBillingTime) : null,
          raw: remote,
        });
        return back({ checkout: "success" });
      }

      return back({ checkout: "pending" });
    }

    /* ── one-off period: capture the approved order ──────────────── */
    if (!orderId) {
      log.warn("paypal return without an order token");
      return back({ checkout: "cancelled" });
    }

    const intent = await findIntent({ providerOrderId: orderId });
    if (!intent) {
      log.warn("paypal return for an unknown order", { orderId });
      return back({ checkout: "unknown" });
    }

    // Already settled by the webhook (which often wins the race) — the member
    // sees success without a redundant capture attempt.
    if (intent.status === "succeeded") return back({ checkout: "success" });

    const capture = await captureOrder(orderId);
    if (!capture.completed) {
      return back({ checkout: "pending", reason: capture.status.toLowerCase() });
    }

    await settleIntent(intent.id, {
      receipt: capture.captureId,
      providerOrderId: orderId,
      providerCustomerId: capture.payerEmail,
      raw: capture,
    });

    return back({ checkout: "success" });
  } catch (err) {
    // A capture that throws is not proof the payment failed — PayPal may have
    // taken it and simply not answered us. Say "pending" so the member is not
    // told their money did not move, and let the webhook settle it.
    log.error("paypal return failed", { error: err instanceof Error ? err.message : String(err) });
    return back({ checkout: "pending", reason: "provider-error" });
  }
}
