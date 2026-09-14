/**
 * Safaricom Daraja — M-Pesa.
 *
 * The flow, in order:
 *
 *   1. `stkPush()` asks Safaricom to prompt the payer's handset with the amount.
 *      It returns a `CheckoutRequestID` **immediately** — the money has not
 *      moved yet, it is just a request.
 *   2. The payer enters their PIN (or ignores the prompt).
 *   3. Safaricom POSTs the outcome to `MPESA_CALLBACK_URL` (the callback route),
 *      and *also* accepts `stkQuery()` polling for the same request, which is
 *      what lets the checkout page show a live status instead of spinning.
 *
 * Two properties matter for safety:
 *
 *   • **The callback body is never trusted as an identity.** It only carries a
 *     `CheckoutRequestID`, which we match against a `PaymentIntent` we created
 *     ourselves. A forged callback cannot name an intent it has not seen, and an
 *     old one cannot be replayed because the intent is only settled once.
 *   • **A successful callback is not a payment until it carries a receipt.**
 *     `ResultCode === 0` with no `MpesaReceiptNumber` is not settled.
 *
 * Credentials (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`,
 * `MPESA_PASSKEY`) are injected from the admin console / Vercel env. On the
 * Daraja sandbox use the test shortcode `174379` with its published passkey; in
 * production use the paybill/till shortcode and the passkey from the Daraja
 * portal — the two are not interchangeable, which is why `MPESA_ENV` is explicit.
 */

import { PaymentProviderError } from "./index";

const env = (name: string) => (process.env[name] ?? "").trim();

export function darajaBaseUrl(): string {
  // Sandbox and production are different hosts *and* different credentials.
  return env("MPESA_ENV").toLowerCase() === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";
}

export function darajaIsProduction(): boolean {
  return env("MPESA_ENV").toLowerCase() === "production";
}

export function darajaShortcode(): string {
  return env("MPESA_SHORTCODE");
}

/** Public callback URL Safaricom should POST the STK result to. */
export function darajaCallbackUrl(): string {
  const configured = env("MPESA_CALLBACK_URL");
  if (configured) return configured;
  const token = env("MPESA_CALLBACK_TOKEN");
  const base = `${env("APP_URL") || env("NEXTAUTH_URL") || "http://localhost:3000"}`.replace(/\/+$/, "");
  return `${base}/api/payments/daraja/callback${token ? `?token=${encodeURIComponent(token)}` : ""}`;
}

/* ------------------------------------------------------------------ */
/* phone numbers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Normalise a Kenyan number to the `2547XXXXXXXX` / `2541XXXXXXXX` form Daraja
 * requires. Returns null for anything that cannot be a Safaricom handset, so a
 * typo is rejected *before* an STK push is wasted on it.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d]/g, "");
  let local = "";

  if (digits.startsWith("254") && digits.length === 12) local = digits.slice(3);
  else if (digits.startsWith("0") && digits.length === 10) local = digits.slice(1);
  else if (digits.length === 9) local = digits;
  else return null;

  // Kenyan mobile prefixes: 7xx (Safaricom) and 1xx (Safaricom/Airtel/Equitel).
  if (!/^[17]\d{8}$/.test(local)) return null;
  return `254${local}`;
}

/** 254712345678 → 0712 345 678 — for display only. */
export function formatPhone(phone: string): string {
  const m = phone.match(/^254(\d{9})$/);
  if (!m) return phone;
  const d = m[1]!;
  return `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

/* ------------------------------------------------------------------ */
/* auth                                                                */
/* ------------------------------------------------------------------ */

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Module-scoped token cache.
 *
 * Daraja's OAuth token is valid for an hour, and every STK push would otherwise
 * pay for a second round trip. Warm serverless instances reuse it; a cold start
 * just fetches once. The 60s safety margin stops a token expiring mid-request.
 */
let cachedToken: CachedToken | null = null;

export async function darajaAccessToken(force = false): Promise<string> {
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }

  const key = env("MPESA_CONSUMER_KEY");
  const secret = env("MPESA_CONSUMER_SECRET");
  if (!key || !secret) {
    throw new PaymentProviderError("daraja", "Daraja credentials are not configured");
  }

  let res: Response;
  try {
    res = await fetch(
      `${darajaBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      }
    );
  } catch (err) {
    throw new PaymentProviderError(
      "daraja",
      "Could not reach Safaricom",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { access_token?: string; expires_in?: string | number; errorMessage?: string }
    | null;

  if (!res.ok || !body?.access_token) {
    throw new PaymentProviderError(
      "daraja",
      body?.errorMessage || "Safaricom rejected the Daraja credentials",
      res.status,
      JSON.stringify(body)
    );
  }

  const seconds = Number(body.expires_in) || 3599;
  cachedToken = { token: body.access_token, expiresAt: Date.now() + seconds * 1000 };
  return cachedToken.token;
}

/* ------------------------------------------------------------------ */
/* STK push                                                            */
/* ------------------------------------------------------------------ */

/** `YYYYMMDDHHmmss` in Africa/Nairobi (UTC+3, no DST) — what Daraja expects. */
export function darajaTimestamp(at: Date = new Date()): string {
  const nairobi = new Date(at.getTime() + 3 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${nairobi.getUTCFullYear()}${p(nairobi.getUTCMonth() + 1)}${p(nairobi.getUTCDate())}` +
    `${p(nairobi.getUTCHours())}${p(nairobi.getUTCMinutes())}${p(nairobi.getUTCSeconds())}`
  );
}

/** base64(shortcode + passkey + timestamp) — regenerated per request. */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
  responseCode: string;
}

/**
 * Send the prompt. The payer's phone buzzes; the money has NOT moved yet.
 *
 * `amount` is whole shillings — M-Pesa rejects decimals, so the caller converts
 * and rounds (see `settlementAmount`).
 */
export async function stkPush(input: {
  phone: string;
  amount: number;
  /** Paybill account number / till reference; our intent reference goes here. */
  reference: string;
  description?: string;
  callbackUrl?: string;
}): Promise<StkPushResult> {
  const shortcode = darajaShortcode();
  const passkey = env("MPESA_PASSKEY");
  if (!shortcode || !passkey) {
    throw new PaymentProviderError("daraja", "Daraja shortcode or passkey is not configured");
  }

  const phone = normalizePhone(input.phone);
  if (!phone) {
    throw new PaymentProviderError(
      "daraja",
      "That does not look like a Kenyan mobile number. Use 07XX XXX XXX or 01XX XXX XXX."
    );
  }

  const amount = Math.round(input.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    throw new PaymentProviderError("daraja", "M-Pesa charges must be at least KSh 1");
  }

  const token = await darajaAccessToken();
  const timestamp = darajaTimestamp();

  const payload = {
    BusinessShortCode: shortcode,
    Password: stkPassword(shortcode, passkey, timestamp),
    Timestamp: timestamp,
    // 174379 (sandbox) and most paybills bill as CustomerPayBillOnline; a till
    // (BuyGoods) must set MPESA_TRANSACTION_TYPE=CustomerBuyGoodsOnline.
    TransactionType: env("MPESA_TRANSACTION_TYPE") || "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: shortcode,
    PhoneNumber: phone,
    CallBackURL: input.callbackUrl || darajaCallbackUrl(),
    AccountReference: input.reference.slice(0, 12),
    TransactionDesc: (input.description || "connectPlus membership").slice(0, 100),
  };

  let res: Response;
  try {
    res = await fetch(`${darajaBaseUrl()}/mpesa/stkpush/v1/processrequest`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new PaymentProviderError(
      "daraja",
      "Safaricom did not answer the STK request",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }

  const body = (await res.json().catch(() => null)) as
    | {
        CheckoutRequestID?: string;
        MerchantRequestID?: string;
        ResponseCode?: string;
        ResponseDescription?: string;
        CustomerMessage?: string;
        errorMessage?: string;
      }
    | null;

  // Daraja returns 200 with ResponseCode "1" for business failures (wrong
  // shortcode, insufficient float on our side) — a 2xx is not success here.
  if (!res.ok || !body?.CheckoutRequestID || (body.ResponseCode && body.ResponseCode !== "0")) {
    throw new PaymentProviderError(
      "daraja",
      body?.errorMessage || body?.ResponseDescription || "Safaricom declined the STK request",
      res.status,
      JSON.stringify(body)
    );
  }

  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID ?? "",
    customerMessage: body.CustomerMessage ?? "Enter your M-Pesa PIN to complete the payment.",
    responseCode: body.ResponseCode ?? "0",
  };
}

/* ------------------------------------------------------------------ */
/* status query                                                        */
/* ------------------------------------------------------------------ */

export interface StkQueryResult {
  /** "0" = paid, "1032" = cancelled by the user, "1037" = timeout, … */
  resultCode: string | null;
  resultDesc: string | null;
  /** True while Safaricom has no verdict yet (still on the handset). */
  pending: boolean;
  raw: unknown;
}

/** Poll the same request the callback will answer — powers the live PIN screen. */
export async function stkQuery(checkoutRequestId: string): Promise<StkQueryResult> {
  const shortcode = darajaShortcode();
  const passkey = env("MPESA_PASSKEY");
  if (!shortcode || !passkey) {
    throw new PaymentProviderError("daraja", "Daraja shortcode or passkey is not configured");
  }

  const token = await darajaAccessToken();
  const timestamp = darajaTimestamp();

  const res = await fetch(`${darajaBaseUrl()}/mpesa/stkpushquery/v1/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: shortcode,
      Password: stkPassword(shortcode, passkey, timestamp),
      Timestamp: timestamp,
      CheckoutRequestID: checkoutRequestId,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    throw new PaymentProviderError(
      "daraja",
      "Could not reach Safaricom for the payment status",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  });

  const body = (await res.json().catch(() => null)) as
    | { ResultCode?: string | number; ResultDesc?: string; errorCode?: string; errorMessage?: string }
    | null;

  // 500.001.1001 = "transaction is being processed": a legitimate pending state,
  // not a failure, and the single most common response while the prompt is open.
  const code = body?.errorCode ?? "";
  if (!res.ok || code) {
    if (code === "500.001.1001") {
      return { resultCode: null, resultDesc: body?.errorMessage ?? "Waiting for your PIN", pending: true, raw: body };
    }
    return {
      resultCode: null,
      resultDesc: body?.errorMessage ?? "Status unavailable",
      pending: true,
      raw: body,
    };
  }

  const resultCode = body?.ResultCode != null ? String(body.ResultCode) : null;
  return {
    resultCode,
    resultDesc: body?.ResultDesc ?? null,
    pending: resultCode === null,
    raw: body,
  };
}

/* ------------------------------------------------------------------ */
/* callback parsing                                                    */
/* ------------------------------------------------------------------ */

export interface StkCallback {
  checkoutRequestId: string;
  merchantRequestId: string;
  resultCode: number;
  resultDesc: string;
  /** Metadata Safaricom only sends on success. */
  amount: number | null;
  receipt: string | null;
  phone: string | null;
  transactionDate: string | null;
  raw: unknown;
}

/**
 * Parse a Daraja STK callback body.
 *
 * Returns null when the shape is not a callback we recognise, so the route can
 * answer 200-with-ignored rather than imply it processed something.
 */
export function parseStkCallback(payload: unknown): StkCallback | null {
  const stk = (payload as { Body?: { stkCallback?: Record<string, unknown> } } | null)?.Body?.stkCallback;
  if (!stk) return null;

  const checkoutRequestId = String(stk.CheckoutRequestID ?? "");
  if (!checkoutRequestId) return null;

  const resultCodeRaw = stk.ResultCode;
  const resultCode = Number(resultCodeRaw);
  if (!Number.isFinite(resultCode)) return null;

  const items =
    (stk.CallbackMetadata as { Item?: { Name?: string; Value?: unknown }[] } | undefined)?.Item ?? [];
  const byName = new Map(items.map((i) => [String(i.Name), i.Value]));

  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  return {
    checkoutRequestId,
    merchantRequestId: String(stk.MerchantRequestID ?? ""),
    resultCode,
    resultDesc: String(stk.ResultDesc ?? ""),
    amount: num(byName.get("Amount")),
    receipt: byName.has("MpesaReceiptNumber") ? String(byName.get("MpesaReceiptNumber")) : null,
    phone: byName.has("PhoneNumber") ? normalizePhone(String(byName.get("PhoneNumber"))) : null,
    transactionDate: byName.has("TransactionDate") ? String(byName.get("TransactionDate")) : null,
    raw: payload,
  };
}

/**
 * Safaricom's published callback source addresses.
 *
 * Off by default: the intent match below is the real authorisation, and this
 * allowlist is defence in depth for deployments that want it. Set
 * `MPESA_CALLBACK_IP_CHECK=on` (with optional `MPESA_ALLOWED_IPS`) to enforce.
 */
export function darajaCallbackIpCheckEnabled(): boolean {
  return env("MPESA_CALLBACK_IP_CHECK").toLowerCase() === "on";
}

const DEFAULT_SAFARICOM_IPS = [
  "196.201.214.200", "196.201.214.206", "196.201.213.114", "196.201.214.207",
  "196.201.214.208", "196.201.213.44", "196.201.212.127", "196.201.212.128",
  "196.201.212.129", "196.201.212.132", "196.201.212.136", "196.201.212.138",
  "196.201.212.69", "196.201.212.70", "196.201.212.71",
];

export function darajaAllowedIps(): string[] {
  const configured = env("MPESA_ALLOWED_IPS");
  const list = configured
    ? configured.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SAFARICOM_IPS;
  return list;
}

/** Best-effort client IP from the proxy headers Vercel/Cloudflare set. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    ""
  ).trim();
}

export function darajaCallbackIpAllowed(ip: string): boolean {
  if (!darajaCallbackIpCheckEnabled()) return true;
  const allowed = darajaAllowedIps();
  if (allowed.length === 0) return true;
  return allowed.includes(ip);
}

/** The shared-secret query param, when `MPESA_CALLBACK_TOKEN` is configured. */
export function darajaCallbackTokenOk(request: Request): boolean {
  const expected = env("MPESA_CALLBACK_TOKEN");
  if (!expected) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === expected;
}
