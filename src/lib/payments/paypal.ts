/**
 * PayPal — cards, PayPal balance, and diaspora members.
 *
 * Two billing shapes, picked per plan:
 *
 *   • **Recurring (preferred).** When a plan carries `paypalPlanMonthlyId` /
 *     `paypalPlanYearlyId` (PayPal's own plan ids), the reader is sent to
 *     PayPal's hosted approval page for a real subscription. PayPal then bills
 *     every cycle on its own and tells us through webhooks — nothing on our side
 *     has to remember to charge anyone.
 *   • **One-off period.** With no PayPal plan id, an Orders v2 capture charges
 *     the current period in one go. This is what makes a plan sellable the
 *     moment the credentials are injected, before anyone has created PayPal
 *     products in the dashboard.
 *
 * Both paths are settled by the *provider's* verdict: a capture id or a
 * verified subscription, never a return URL. The browser coming back to
 * `/pricing?checkout=success` proves nothing and grants nothing — it is only a
 * cue to refresh the member's view of a subscription that a webhook already
 * created.
 *
 * `PAYPAL_ENV=live` switches to the production host; anything else is sandbox.
 */

import { PaymentProviderError } from "./index";

const env = (name: string) => (process.env[name] ?? "").trim();

export function paypalBaseUrl(): string {
  return env("PAYPAL_ENV").toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

export function paypalIsLive(): boolean {
  return env("PAYPAL_ENV").toLowerCase() === "live";
}

export function paypalWebhookId(): string {
  return env("PAYPAL_WEBHOOK_ID");
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

let cachedToken: { token: string; expiresAt: number } | null = null;

/** Client-credentials OAuth token, cached for its ~9h lifetime. */
export async function paypalAccessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const clientId = env("PAYPAL_CLIENT_ID");
  const secret = env("PAYPAL_CLIENT_SECRET");
  if (!clientId || !secret) {
    throw new PaymentProviderError("paypal", "PayPal credentials are not configured");
  }

  let res: Response;
  try {
    res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new PaymentProviderError(
      "paypal",
      "Could not reach PayPal",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error_description?: string }
    | null;

  if (!res.ok || !body?.access_token) {
    throw new PaymentProviderError(
      "paypal",
      body?.error_description || "PayPal rejected the API credentials",
      res.status,
      JSON.stringify(body)
    );
  }

  const seconds = Number(body.expires_in) || 3200;
  cachedToken = { token: body.access_token, expiresAt: Date.now() + seconds * 1000 };
  return cachedToken.token;
}

async function paypalFetch<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {}
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const token = await paypalAccessToken();
  const { idempotencyKey, headers, ...rest } = init;

  let res: Response;
  try {
    res = await fetch(`${paypalBaseUrl()}${path}`, {
      ...rest,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
        ...(headers as Record<string, string> | undefined),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new PaymentProviderError(
      "paypal",
      "PayPal did not answer",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }

  const body = (await res.json().catch(() => null)) as T | null;
  return { ok: res.ok, status: res.status, body };
}

/* ------------------------------------------------------------------ */
/* orders (one-off period)                                             */
/* ------------------------------------------------------------------ */

export interface PaypalOrder {
  orderId: string;
  approveUrl: string;
  status: string;
}

/** Create an order for one billing period and return its approval link. */
export async function createOrder(input: {
  reference: string;
  amount: number;
  currency: string;
  description: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<PaypalOrder> {
  const { ok, status, body } = await paypalFetch<{
    id?: string;
    status?: string;
    links?: { href: string; rel: string }[];
    message?: string;
    details?: { description?: string }[];
  }>("/v2/checkout/orders", {
    method: "POST",
    // The request id doubles as our reference, so a retried create cannot
    // produce two orders the member could pay twice.
    idempotencyKey: input.reference,
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.reference,
          custom_id: input.reference,
          description: input.description.slice(0, 127),
          amount: { currency_code: input.currency, value: input.amount.toFixed(2) },
        },
      ],
      application_context: {
        brand_name: "connectPlus",
        locale: "en-KE",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
  });

  const approveUrl = body?.links?.find((l) => l.rel === "approve")?.href;
  if (!ok || !body?.id || !approveUrl) {
    throw new PaymentProviderError(
      "paypal",
      body?.details?.[0]?.description || body?.message || "PayPal could not create the order",
      status,
      JSON.stringify(body)
    );
  }

  return { orderId: body.id, approveUrl, status: body.status ?? "CREATED" };
}

export interface PaypalCapture {
  status: string;
  captureId: string | null;
  amount: number | null;
  currency: string | null;
  payerEmail: string | null;
  reference: string | null;
  completed: boolean;
}

/** Capture an approved order. This is the moment money actually moves. */
export async function captureOrder(orderId: string): Promise<PaypalCapture> {
  const { ok, status, body } = await paypalFetch<{
    id?: string;
    status?: string;
    payer?: { email_address?: string };
    purchase_units?: {
      custom_id?: string;
      reference_id?: string;
      payments?: { captures?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string } }[] };
    }[];
    message?: string;
  }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST" });

  if (!ok || !body) {
    throw new PaymentProviderError(
      "paypal",
      body?.message || "PayPal could not capture the payment",
      status,
      JSON.stringify(body)
    );
  }

  const unit = body.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];

  return {
    status: body.status ?? "UNKNOWN",
    captureId: capture?.id ?? null,
    amount: capture?.amount?.value ? Number(capture.amount.value) : null,
    currency: capture?.amount?.currency_code ?? null,
    payerEmail: body.payer?.email_address ?? null,
    reference: unit?.custom_id ?? unit?.reference_id ?? null,
    // COMPLETED is the only status that means the money is ours.
    completed: body.status === "COMPLETED",
  };
}

export async function getOrder(orderId: string): Promise<{
  status: string;
  reference: string | null;
  captureId: string | null;
  amount: number | null;
  currency: string | null;
} | null> {
  const { ok, body } = await paypalFetch<{
    status?: string;
    purchase_units?: {
      custom_id?: string;
      reference_id?: string;
      payments?: { captures?: { id?: string; amount?: { value?: string; currency_code?: string } }[] };
    }[];
  }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, { method: "GET" });

  if (!ok || !body) return null;
  const unit = body.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];
  return {
    status: body.status ?? "UNKNOWN",
    reference: unit?.custom_id ?? unit?.reference_id ?? null,
    captureId: capture?.id ?? null,
    amount: capture?.amount?.value ? Number(capture.amount.value) : null,
    currency: capture?.amount?.currency_code ?? null,
  };
}

/* ------------------------------------------------------------------ */
/* subscriptions (recurring)                                           */
/* ------------------------------------------------------------------ */

export interface PaypalSubscription {
  subscriptionId: string;
  approveUrl: string;
  status: string;
}

/** Create a real recurring subscription against a PayPal plan id. */
export async function createSubscription(input: {
  planId: string;
  reference: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<PaypalSubscription> {
  const { ok, status, body } = await paypalFetch<{
    id?: string;
    status?: string;
    links?: { href: string; rel: string }[];
    message?: string;
  }>("/v1/billing/subscriptions", {
    method: "POST",
    idempotencyKey: input.reference,
    body: JSON.stringify({
      plan_id: input.planId,
      custom_id: input.reference,
      application_context: {
        brand_name: "connectPlus",
        locale: "en-KE",
        shipping_preference: "NO_SHIPPING",
        user_action: "SUBSCRIBE_NOW",
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
      },
    }),
  });

  const approveUrl = body?.links?.find((l) => l.rel === "approve")?.href;
  if (!ok || !body?.id || !approveUrl) {
    throw new PaymentProviderError(
      "paypal",
      body?.message || "PayPal could not create the subscription",
      status,
      JSON.stringify(body)
    );
  }

  return { subscriptionId: body.id, approveUrl, status: body.status ?? "APPROVAL_PENDING" };
}

export interface PaypalSubscriptionState {
  status: string;
  planId: string | null;
  reference: string | null;
  subscriberEmail: string | null;
  /** ISO timestamp of the next automatic charge, when PayPal reports one. */
  nextBillingTime: string | null;
  active: boolean;
}

export async function getSubscription(subscriptionId: string): Promise<PaypalSubscriptionState | null> {
  const { ok, body } = await paypalFetch<{
    status?: string;
    plan_id?: string;
    custom_id?: string;
    subscriber?: { email_address?: string };
    billing_info?: { next_billing_time?: string };
  }>(`/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "GET" });

  if (!ok || !body?.status) return null;
  return {
    status: body.status,
    planId: body.plan_id ?? null,
    reference: body.custom_id ?? null,
    subscriberEmail: body.subscriber?.email_address ?? null,
    nextBillingTime: body.billing_info?.next_billing_time ?? null,
    active: body.status === "ACTIVE",
  };
}

/* ------------------------------------------------------------------ */
/* webhooks                                                            */
/* ------------------------------------------------------------------ */

export interface PaypalWebhookHeaders {
  transmissionId: string;
  transmissionTime: string;
  certUrl: string;
  authAlgo: string;
  transmissionSig: string;
}

export function paypalWebhookHeaders(request: Request): PaypalWebhookHeaders | null {
  const h = (name: string) => request.headers.get(name) ?? "";
  const headers: PaypalWebhookHeaders = {
    transmissionId: h("paypal-transmission-id"),
    transmissionTime: h("paypal-transmission-time"),
    certUrl: h("paypal-cert-url"),
    authAlgo: h("paypal-auth-algo"),
    transmissionSig: h("paypal-transmission-sig"),
  };
  if (Object.values(headers).some((v) => !v)) return null;
  return headers;
}

/**
 * Verify a webhook through PayPal's own verification API.
 *
 * Doing the signature math locally would mean fetching and caching PayPal's
 * signing cert; asking the issuer to verify keeps this short and fails closed.
 * Without `PAYPAL_WEBHOOK_ID` we cannot verify, so we refuse — an unverified
 * webhook is an anonymous request asking to be given a paid plan.
 */
export async function verifyWebhook(
  headers: PaypalWebhookHeaders,
  event: unknown
): Promise<{ verified: boolean; reason?: string }> {
  const webhookId = paypalWebhookId();
  if (!webhookId) return { verified: false, reason: "PAYPAL_WEBHOOK_ID is not configured" };

  const { ok, status, body } = await paypalFetch<{ verification_status?: string }>(
    "/v1/notifications/verify-webhook-signature",
    {
      method: "POST",
      body: JSON.stringify({
        auth_algo: headers.authAlgo,
        cert_url: headers.certUrl,
        transmission_id: headers.transmissionId,
        transmission_sig: headers.transmissionSig,
        transmission_time: headers.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
    }
  );

  const verdict = body?.verification_status;
  if (!ok) return { verified: false, reason: `verification call failed (HTTP ${status})` };
  return verdict === "SUCCESS" ? { verified: true } : { verified: false, reason: verdict ?? "unknown" };
}

/** PayPal subscription statuses mapped onto our own vocabulary. */
export function mapPaypalSubscriptionStatus(status: string): string {
  switch (status.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "APPROVAL_PENDING":
    case "APPROVED":
      return "trialing";
    case "SUSPENDED":
      return "past_due";
    case "CANCELLED":
    case "EXPIRED":
      return "cancelled";
    default:
      return "active";
  }
}
