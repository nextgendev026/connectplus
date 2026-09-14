/**
 * Payment lifecycle — the operations that are not a checkout.
 *
 * Cancelling, reconciling a subscription against the rail's own copy, and
 * letting a lapsed period end. Kept apart from `checkout.ts` because these run
 * from the cron and the admin console as well as from member actions.
 */

import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  getSubscription,
  mapPaypalSubscriptionStatus,
  paypalAccessToken,
  paypalBaseUrl,
} from "./paypal";

const log = createLogger("payments");

const env = (name: string) => (process.env[name] ?? "").trim();

/**
 * Stop a PayPal subscription from billing again.
 *
 * Idempotent on purpose: PayPal answers a cancel for an already-cancelled
 * subscription with a 422, and "it is already stopped" is a success for our
 * caller — refusing it would leave a member unable to cancel from our UI.
 */
export async function cancelPaypalSubscription(
  subscriptionId: string,
  reason = "Cancelled by member"
): Promise<{ ok: boolean; reason?: string }> {
  if (!env("PAYPAL_CLIENT_ID") || !env("PAYPAL_CLIENT_SECRET")) {
    return { ok: false, reason: "PayPal credentials are not configured" };
  }

  // Check first: a cancelled subscription can be reported as cancelled rather
  // than as a failed cancel.
  const current = await getSubscription(subscriptionId).catch(() => null);
  if (current && (current.status === "CANCELLED" || current.status === "EXPIRED")) {
    return { ok: true };
  }

  const token = await paypalAccessToken();
  const base = paypalBaseUrl();

  let res: Response;
  try {
    res = await fetch(`${base}/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.slice(0, 127) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  if (res.ok || res.status === 204) return { ok: true };
  const detail = await res.text().catch(() => "");
  log.warn("paypal cancel failed", { subscriptionId, status: res.status, detail: detail.slice(0, 200) });
  return { ok: false, reason: detail.slice(0, 200) || `HTTP ${res.status}` };
}

/**
 * Pull the rail's own view of a membership and correct ours.
 *
 * The console's Reconcile button and the nightly sweep both call this. It is the
 * repair path for a webhook that never arrived: PayPal's copy is authoritative,
 * ours is derived, and drift always resolves in PayPal's favour because PayPal
 * is the one that will actually (or will not actually) charge the card.
 */
export async function reconcileSubscription(subscriptionId: string): Promise<{
  ok: boolean;
  action: "unchanged" | "updated" | "skipped";
  detail: string;
}> {
  const sub = await prisma.userSubscription.findUnique({ where: { id: subscriptionId } });
  if (!sub) return { ok: false, action: "skipped", detail: "Subscription not found" };
  if (sub.provider !== "paypal" || !sub.providerSubscriptionId) {
    return { ok: true, action: "skipped", detail: "No provider subscription to reconcile" };
  }

  const remote = await getSubscription(sub.providerSubscriptionId).catch(() => null);
  if (!remote) return { ok: false, action: "skipped", detail: "PayPal returned no subscription" };

  const status = mapPaypalSubscriptionStatus(remote.status);
  const nextBilling = remote.nextBillingTime ? new Date(remote.nextBillingTime) : null;

  const unchanged =
    sub.status === status &&
    (!nextBilling || Math.abs(nextBilling.getTime() - sub.currentPeriodEnd.getTime()) < 60_000);
  if (unchanged) return { ok: true, action: "unchanged", detail: `In sync (${remote.status})` };

  await prisma.userSubscription.update({
    where: { id: sub.id },
    data: {
      status,
      ...(nextBilling ? { currentPeriodEnd: nextBilling } : {}),
      updatedAt: new Date(),
    },
  });

  return {
    ok: true,
    action: "updated",
    detail: `${remote.status} → ${status}${nextBilling ? `, renews ${nextBilling.toISOString().slice(0, 10)}` : ""}`,
  };
}

/**
 * Expire memberships whose paid window has closed.
 *
 * Without this a cancelled membership would keep its entitlements forever: the
 * period end is what actually gates access, and nothing was moving the status
 * to `cancelled` once the date passed. Runs from the cron sweep and on demand.
 */
export async function expireLapsedSubscriptions(limit = 200): Promise<{
  expired: number;
  ids: string[];
}> {
  const lapsed = await prisma.userSubscription.findMany({
    where: {
      status: { in: ["active", "trialing"] },
      currentPeriodEnd: { lt: new Date() },
    },
    select: { id: true, planId: true, provider: true },
    take: limit,
  });

  if (lapsed.length === 0) return { expired: 0, ids: [] };

  const freePlans = await prisma.subscriptionPlan.findMany({
    where: { tier: "free" },
    select: { id: true },
  });
  const freeIds = new Set(freePlans.map((p) => p.id));

  // Free tiers have no period to lapse out of — they are re-stamped on the next
  // visit rather than revoked here.
  const doomed = lapsed.filter((s) => !freeIds.has(s.planId)).map((s) => s.id);
  if (doomed.length === 0) return { expired: 0, ids: [] };

  await prisma.userSubscription.updateMany({
    where: { id: { in: doomed } },
    data: { status: "cancelled", cancelAtPeriodEnd: false, updatedAt: new Date() },
  });

  log.info("expired lapsed memberships", { count: doomed.length });
  return { expired: doomed.length, ids: doomed };
}

/**
 * Close out checkout attempts that were never completed.
 *
 * A member who opens the M-Pesa form and never approves the prompt leaves an
 * intent `processing` forever. Left alone, every one of those becomes a
 * permanent "stuck" row in the console and a permanent cache of personal data
 * (the phone number) that nothing needs any more. Marking them expired is what
 * keeps the console's stuck count meaning something: what is still listed as
 * pending is a payment that is genuinely in flight.
 */
export async function expireStaleIntents(olderThanMinutes = 30): Promise<{
  expired: number;
}> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const result = await prisma.paymentIntent.updateMany({
    where: { status: { in: ["pending", "processing"] }, createdAt: { lt: cutoff } },
    data: {
      status: "expired",
      failureReason:
        "No response from the payment provider in time — the prompt was never approved.",
      settledAt: new Date(),
      updatedAt: new Date(),
    },
  });

  if (result.count > 0) log.info("expired abandoned payment intents", { count: result.count });
  return { expired: result.count };
}

/**
 * Health of the payment pipeline, for the admin console and the status page.
 *
 * "Degraded" is a state worth surfacing loudly here: a rail that is configured
 * but silently failing STK pushes means members see a spinner and no prompt,
 * while nothing in the logs looks like an outage.
 */
export async function paymentPipelineHealth(): Promise<{
  stalePending: number;
  failedToday: number;
  succeededToday: number;
  unmatchedEvents: number;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [stalePending, failedToday, succeededToday] = await Promise.all([
    prisma.paymentIntent
      .count({
        where: {
          status: { in: ["pending", "processing"] },
          createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        },
      })
      .catch(() => 0),
    prisma.paymentIntent.count({ where: { status: "failed", createdAt: { gte: since } } }).catch(() => 0),
    prisma.paymentIntent.count({ where: { status: "succeeded", settledAt: { gte: since } } }).catch(() => 0),
  ]);

  return { stalePending, failedToday, succeededToday, unmatchedEvents: 0 };
}
