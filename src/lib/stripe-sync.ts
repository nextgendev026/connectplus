import type Stripe from "stripe";
import { periodWindow } from "@/lib/stripe";

/**
 * Pure helpers behind the Stripe webhook.
 *
 * They live outside the route file for two reasons: Next only allows handler
 * exports from a `route.ts`, and these are the pieces worth unit-testing —
 * status mapping, the billing window (which Stripe's 2026 API generation
 * exposed differently), and the invoice→subscription lookup.
 */

/** Our subscription status vocabulary, derived from Stripe's. */
export function mapStripeStatus(status: Stripe.Subscription.Status): string {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  return "cancelled";
}

/**
 * Current billing window for a subscription. This API generation exposes the
 * period as `billing_cycle_anchor` (start) + `billing_schedules[].bill_until`
 * (end) instead of `current_period_start/end`; falls back to a cycle-derived
 * window so the webhook never needs to know our billing-cycle metadata.
 */
export function subscriptionPeriod(
  sub: Stripe.Subscription | null | undefined,
  fallbackCycle: "monthly" | "yearly"
): { start: Date; end: Date } {
  if (sub) {
    const startSec = sub.billing_cycle_anchor ?? sub.start_date ?? null;
    const endSec = sub.billing_schedules?.[0]?.bill_until?.timestamp ?? null;
    if (startSec || endSec) {
      const start = startSec ? new Date(startSec * 1000) : new Date();
      const end = endSec ? new Date(endSec * 1000) : periodWindow(fallbackCycle, start).end;
      return { start, end };
    }
  }
  return periodWindow(fallbackCycle, new Date());
}

/** Link an invoice back to its originating subscription. */
export function invoiceSubscriptionId(inv: Stripe.Invoice): string | undefined {
  const top = inv as unknown as { subscription?: string | null };
  if (top.subscription) return top.subscription;
  const line = inv.lines.data[0];
  const parent = line?.parent as unknown as
    | { subscription_details?: { subscription?: string | null } }
    | undefined;
  return parent?.subscription_details?.subscription ?? undefined;
}

/** A Prisma unique-constraint violation — how we spot a duplicate delivery. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/**
 * The window an invoice covers, which is authoritative at payment time: it is
 * what makes a missed `customer.subscription.updated` self-correct on the next
 * successful charge instead of leaving a stale period end in the database.
 */
export function invoicePeriod(inv: Stripe.Invoice): { start: Date; end: Date } | null {
  const start = inv.period_start ? new Date(inv.period_start * 1000) : null;
  const end = inv.period_end ? new Date(inv.period_end * 1000) : null;
  if (!start && !end) return null;
  return { start: start ?? new Date(), end: end ?? periodWindow("monthly", start ?? new Date()).end };
}
