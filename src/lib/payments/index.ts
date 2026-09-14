/**
 * Payment rails for East Africa.
 *
 * Two providers, one pipeline:
 *
 *   • **Safaricom Daraja (M-Pesa)** — the rail that actually reaches a Kenyan
 *     reader. A STK push puts the prompt on their handset and the money moves
 *     without a card, a form or a redirect.
 *   • **PayPal** — cards and diaspora/international members, settled in USD
 *     because PayPal does not settle in KES.
 *
 * Stripe was removed: it does not serve East Africa, so every plan above the
 * free tier was unreachable for the audience this platform is built for.
 *
 * Money is never trusted from a callback. `PaymentIntent` is created first and
 * every notification is matched back to it by our own reference, then the
 * *provider's* verdict (a receipt, a capture id) is what settles it. That is
 * what makes a replayed callback harmless.
 */

export type PaymentProviderId = "daraja" | "paypal";

export interface PaymentProviderMeta {
  id: PaymentProviderId;
  name: string;
  /** What the reader recognises on the checkout button. */
  method: string;
  description: string;
  /** Currency this rail settles in. M-Pesa is KES-only; PayPal cannot settle KES. */
  currency: string;
  configured: boolean;
  /** Environment variables that are still missing, in reading order. */
  missing: string[];
  docs: { label: string; href: string }[];
}

const env = (name: string) => (process.env[name] ?? "").trim();

/* ------------------------------------------------------------------ */
/* app url / billing windows                                           */
/* ------------------------------------------------------------------ */

/** Canonical app URL for provider return/callback URLs. */
export function appUrl(): string {
  return (
    env("APP_URL") ||
    env("NEXTAUTH_URL") ||
    env("AUTH_URL") ||
    (env("VERCEL_URL") ? `https://${env("VERCEL_URL")}` : "") ||
    "http://localhost:3000"
  );
}

/** Mid-cycle "billing window" shared by checkout, callbacks and quotas. */
export function periodWindow(
  cycle: "monthly" | "yearly",
  start: Date = new Date()
): { start: Date; end: Date } {
  const end = new Date(start);
  if (cycle === "yearly") end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return { start, end };
}

export function normalizeCycle(value: unknown): "monthly" | "yearly" {
  return value === "yearly" ? "yearly" : "monthly";
}

/* ------------------------------------------------------------------ */
/* pricing                                                             */
/* ------------------------------------------------------------------ */

/**
 * KES per USD used to price a USD plan on the M-Pesa rail.
 *
 * A static rate is deliberate: M-Pesa cannot settle a fractional shilling, and
 * a rate fetched per checkout would make the same plan cost different amounts
 * within the same day — an invoice the member could not reconcile. Override
 * with `MPESA_KES_PER_USD` and re-price the plans when it drifts.
 */
export function kesPerUsd(): number {
  const raw = Number(env("MPESA_KES_PER_USD"));
  return Number.isFinite(raw) && raw > 0 ? raw : 129;
}

export interface SettlementAmount {
  amount: number;
  currency: string;
  listAmount: number;
  listCurrency: string;
  /** True when the rail's currency differs from the plan's, so the UI can explain it. */
  converted: boolean;
  /** Whole-shilling rounding was applied (M-Pesa rejects decimals). */
  rounded: boolean;
}

/**
 * What a rail will actually charge for a plan and cycle.
 *
 * Plans are priced in USD (the platform's accounting currency). Daraja needs
 * whole KES, PayPal cannot settle KES at all, so the plan price is converted
 * per rail and the original is carried alongside for display.
 */
export function settlementAmount(
  plan: { priceMonthly: number; priceYearly: number; currency: string },
  cycle: "monthly" | "yearly",
  provider: PaymentProviderId
): SettlementAmount {
  const listCurrency = (plan.currency || "USD").toUpperCase();
  const listAmount = cycle === "yearly" ? plan.priceYearly : plan.priceMonthly;

  if (provider === "daraja") {
    // USD-plan → KES. A plan already priced in KES is charged as-is.
    const kes = listCurrency === "KES" ? listAmount : listAmount * kesPerUsd();
    const amount = Math.max(1, Math.round(kes));
    return {
      amount,
      currency: "KES",
      listAmount,
      listCurrency,
      converted: listCurrency !== "KES",
      rounded: true,
    };
  }

  // PayPal cannot settle KES, so a KES-priced plan is converted back to USD
  // through the SAME rate the M-Pesa rail uses. Charging 650 KES as 650 USD
  // would be a hundredfold overcharge, which is the whole reason the rate is a
  // single shared helper rather than a per-rail afterthought.
  const settled = !listCurrency || listCurrency === "KES" ? "USD" : listCurrency;
  const raw = settled === listCurrency ? listAmount : listAmount / kesPerUsd();
  // PayPal settles to two decimal places; anything below a cent is lost anyway.
  const amount = Math.min(999999.99, Math.max(settled === "USD" ? 0.01 : 1, Math.round(raw * 100) / 100));
  return {
    amount,
    currency: settled,
    listAmount,
    listCurrency,
    converted: settled !== listCurrency,
    rounded: false,
  };
}

/** `fmt-9f2a1c...` — unique, quoted back by the provider, never a secret. */
export function newReference(provider: PaymentProviderId): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${provider}-${Date.now().toString(36)}${rand}`;
}

/* ------------------------------------------------------------------ */
/* provider registry                                                   */
/* ------------------------------------------------------------------ */

export function darajaMissing(): string[] {
  return ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY"].filter(
    (name) => !env(name)
  );
}

export function paypalMissing(): string[] {
  return ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"].filter((name) => !env(name));
}

export function darajaConfigured(): boolean {
  return darajaMissing().length === 0;
}

export function paypalConfigured(): boolean {
  return paypalMissing().length === 0;
}

export function providerConfigured(provider: string): boolean {
  if (provider === "daraja") return darajaConfigured();
  if (provider === "paypal") return paypalConfigured();
  return false;
}

/** Every rail, with enough state for the UI and the admin console to explain it. */
export function paymentProviders(): PaymentProviderMeta[] {
  const missing = darajaMissing();
  const ppMissing = paypalMissing();
  return [
    {
      id: "daraja",
      name: "Safaricom Daraja",
      method: "M-Pesa",
      description:
        "Pay by STK push — the prompt arrives on your phone and the shillings leave your M-Pesa wallet. No card needed.",
      currency: "KES",
      configured: missing.length === 0,
      missing,
      docs: [
        { label: "Daraja portal", href: "https://developer.safaricom.co.ke/" },
        { label: "STK push (Lipa na M-Pesa)", href: "https://developer.safaricom.co.ke/APIs/MpesaExpressSimulate" },
      ],
    },
    {
      id: "paypal",
      name: "PayPal",
      method: "PayPal / card",
      description:
        "Pay with your PayPal balance, a linked bank or a card — the right rail for diaspora and international members.",
      currency: "USD",
      configured: ppMissing.length === 0,
      missing: ppMissing,
      docs: [
        { label: "PayPal developer dashboard", href: "https://developer.paypal.com/dashboard/applications" },
        { label: "Orders v2 API", href: "https://developer.paypal.com/docs/api/orders/v2/" },
      ],
    },
  ];
}

/** The rails a reader can actually pick right now. */
export function enabledProviders(): PaymentProviderMeta[] {
  return paymentProviders().filter((p) => p.configured);
}

export function anyPaymentProviderConfigured(): boolean {
  return enabledProviders().length > 0;
}

/* ------------------------------------------------------------------ */
/* errors                                                              */
/* ------------------------------------------------------------------ */

/** A provider call we could not complete — never a user error. */
export class PaymentProviderError extends Error {
  constructor(
    public provider: PaymentProviderId,
    message: string,
    public status?: number,
    public detail?: string
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

/** A Prisma unique-constraint violation — how we spot a duplicate delivery. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}
