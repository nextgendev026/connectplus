import Stripe from "stripe";

/**
 * Stripe service layer. The instance is created lazily so the rest of the app
 * keeps working (free plans, local dev) when STRIPE_SECRET_KEY is absent.
 */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, {
    apiVersion: "2026-08-26.dahlia",
    typescript: true,
  });
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** Public app URL used for checkout success/cancel return links. */
export function appUrl(): string {
  return (
    process.env.APP_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    process.env.AUTH_URL?.trim() ||
    "http://localhost:3000"
  );
}

/** Mid-cycle "billing window" helpers shared by checkout, webhook and quotas. */
export function periodWindow(
  cycle: "monthly" | "yearly",
  start: Date = new Date()
): { start: Date; end: Date } {
  const end = new Date(start);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
}