import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  anyPaymentProviderConfigured,
  kesPerUsd,
  paymentProviders,
  settlementAmount,
  type PaymentProviderId,
} from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/payments/providers
 *
 * What the pricing page needs to render a checkout it can actually complete:
 * which rails are live, and what each one will charge for every plan. The prices
 * are computed server-side by the same `settlementAmount` the checkout uses, so
 * the number on the button and the number on the M-Pesa prompt can never differ
 * — a mismatch there is the fastest way to lose a payer's trust.
 *
 * Never exposes credentials: only presence and the missing variable *names*.
 */
export async function GET() {
  const providers = paymentProviders();
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true },
    select: {
      id: true,
      tier: true,
      audience: true,
      priceMonthly: true,
      priceYearly: true,
      currency: true,
    },
  });

  const prices: Record<string, Record<string, ReturnType<typeof settlementAmount>>> = {};
  for (const plan of plans) {
    for (const provider of providers) {
      if (!provider.configured) continue;
      prices[plan.id] = prices[plan.id] ?? {};
      prices[plan.id]![provider.id] = settlementAmount(plan, "monthly", provider.id as PaymentProviderId);
      prices[plan.id]![`${provider.id}_yearly`] = settlementAmount(
        plan,
        "yearly",
        provider.id as PaymentProviderId
      );
    }
  }

  return NextResponse.json(
    {
      anyConfigured: anyPaymentProviderConfigured(),
      kesPerUsd: kesPerUsd(),
      providers: providers.map((p) => ({
        id: p.id,
        name: p.name,
        method: p.method,
        description: p.description,
        currency: p.currency,
        configured: p.configured,
        missing: p.missing,
      })),
      prices,
    },
    {
      // Presence of credentials changes only when env changes; the derived
      // prices change only when an admin edits a plan.
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
    }
  );
}
