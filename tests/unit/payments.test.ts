import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isUniqueViolation,
  kesPerUsd,
  newReference,
  normalizeCycle,
  periodWindow,
  settlementAmount,
} from "../../src/lib/payments";
import {
  darajaCallbackIpAllowed,
  darajaCallbackTokenOk,
  darajaTimestamp,
  normalizePhone,
  parseStkCallback,
  stkPassword,
} from "../../src/lib/payments/daraja";
import {
  mapPaypalSubscriptionStatus,
  paypalWebhookHeaders,
} from "../../src/lib/payments/paypal";
import { darajaResultMessage, intentStatusForResultCode } from "../../src/lib/payments/fulfill";

/**
 * Payment contract tests.
 *
 * These pin the pieces that are expensive to get wrong and cheap to test: how a
 * phone number is normalised before an STK push, whether a callback is
 * recognised at all, and what a rail is charged for a plan. A bug in any of them
 * either takes a member's money without granting a plan, or grants one without
 * taking the money.
 */

const PLAN = {
  priceMonthly: 5,
  priceYearly: 50,
  currency: "USD",
};

describe("kenyan phone normalisation", () => {
  it("accepts every spelling of the same handset", () => {
    for (const input of ["0712345678", "+254712345678", "254712345678", "712345678", "0712 345 678"]) {
      expect(normalizePhone(input), input).toBe("254712345678");
    }
  });

  it("accepts the 01x Safaricom/Airtel ranges", () => {
    expect(normalizePhone("0110000000")).toBe("254110000000");
    expect(normalizePhone("254110000000")).toBe("254110000000");
  });

  it("rejects anything that is not a Kenyan mobile number", () => {
    for (const input of ["", null, undefined, "12345", "+14155552671", "0812345678", "071234567890"]) {
      expect(normalizePhone(input as string), String(input)).toBeNull();
    }
  });
});

describe("daraja request signing", () => {
  it("formats the timestamp in Nairobi time (UTC+3), not the server's zone", () => {
    // 2026-09-14T09:05:06Z → 12:05:06 in Nairobi.
    expect(darajaTimestamp(new Date("2026-09-14T09:05:06Z"))).toBe("20260914120506");
  });

  it("base64-encodes shortcode + passkey + timestamp as one string", () => {
    const password = stkPassword("174379", "passkey", "20260914120506");
    expect(Buffer.from(password, "base64").toString()).toBe("174379passkey20260914120506");
  });
});

describe("stk callback parsing", () => {
  const success = {
    Body: {
      stkCallback: {
        MerchantRequestID: "29115-34620561-1",
        CheckoutRequestID: "ws_CO_191220191020363925",
        ResultCode: 0,
        ResultDesc: "The service request is processed successfully.",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: 645 },
            { Name: "MpesaReceiptNumber", Value: "NLJ7RT61SV" },
            { Name: "TransactionDate", Value: 20260914120506 },
            { Name: "PhoneNumber", Value: 254712345678 },
          ],
        },
      },
    },
  };

  it("reads the receipt, amount and payer from a successful callback", () => {
    const parsed = parseStkCallback(success);
    expect(parsed).not.toBeNull();
    expect(parsed!.checkoutRequestId).toBe("ws_CO_191220191020363925");
    expect(parsed!.resultCode).toBe(0);
    expect(parsed!.receipt).toBe("NLJ7RT61SV");
    expect(parsed!.amount).toBe(645);
    expect(parsed!.phone).toBe("254712345678");
  });

  it("carries no receipt on a cancelled prompt", () => {
    const parsed = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: "m-1",
          CheckoutRequestID: "ws_CO_cancelled",
          ResultCode: 1032,
          ResultDesc: "The request was cancelled by the user.",
        },
      },
    });
    // The absence of a receipt is what stops a cancellation being mistaken for a
    // payment, so it has to survive parsing as an explicit null.
    expect(parsed!.resultCode).toBe(1032);
    expect(parsed!.receipt).toBeNull();
    expect(parsed!.amount).toBeNull();
  });

  it("returns null for anything that is not a callback", () => {
    expect(parseStkCallback(null)).toBeNull();
    expect(parseStkCallback({})).toBeNull();
    expect(parseStkCallback({ Body: { stkCallback: { CheckoutRequestID: "x" } } })).toBeNull();
    expect(parseStkCallback({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull();
  });
});

describe("result code mapping", () => {
  it("treats only code 0 as a payment", () => {
    expect(intentStatusForResultCode(0)).toBe("succeeded");
  });

  it("separates a member's cancellation from a failure", () => {
    // 1032 = cancelled on the handset, 1037 = timed out unanswered. Neither is a
    // failed payment, and the console should not report them as one.
    expect(intentStatusForResultCode(1032)).toBe("cancelled");
    expect(intentStatusForResultCode(1037)).toBe("cancelled");
    expect(intentStatusForResultCode(2001)).toBe("failed");
    expect(intentStatusForResultCode(9999)).toBe("failed");
  });

  it("explains the failure in words a member can act on", () => {
    expect(darajaResultMessage(1037)).toContain("timed out");
    expect(darajaResultMessage(2001)).toContain("PIN");
    expect(darajaResultMessage(1)).toContain("balance");
  });
});

describe("per-rail pricing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("converts a USD plan to whole shillings for M-Pesa", () => {
    vi.stubEnv("MPESA_KES_PER_USD", "130");
    const quote = settlementAmount(PLAN, "monthly", "daraja");
    expect(quote.currency).toBe("KES");
    expect(quote.amount).toBe(650);
    expect(Number.isInteger(quote.amount)).toBe(true);
    expect(quote.listAmount).toBe(5);
    expect(quote.converted).toBe(true);
  });

  it("charges a KES plan as-is, with no conversion", () => {
    const quote = settlementAmount({ ...PLAN, currency: "KES" }, "monthly", "daraja");
    expect(quote.amount).toBe(5);
    expect(quote.converted).toBe(false);
  });

  it("never prices a paid plan at zero shillings", () => {
    vi.stubEnv("MPESA_KES_PER_USD", "0.0001");
    const quote = settlementAmount({ ...PLAN, priceMonthly: 0.01 }, "monthly", "daraja");
    expect(quote.amount).toBeGreaterThanOrEqual(1);
  });

  it("settles PayPal in USD because PayPal cannot settle KES", () => {
    vi.stubEnv("MPESA_KES_PER_USD", "130");
    const quote = settlementAmount({ ...PLAN, currency: "KES", priceMonthly: 650 }, "monthly", "paypal");
    expect(quote.currency).toBe("USD");
    // 650 KES is $5, not $650. A KES-priced plan must be divided back through
    // the same rate the M-Pesa rail multiplies by — anything else is a
    // hundredfold overcharge on an international member's card.
    expect(quote.amount).toBe(5);
    expect(quote.converted).toBe(true);
  });

  it("settles a GBP plan in GBP rather than converting it", () => {
    const quote = settlementAmount({ ...PLAN, currency: "GBP", priceMonthly: 7 }, "monthly", "paypal");
    expect(quote.currency).toBe("GBP");
    expect(quote.amount).toBe(7);
    expect(quote.converted).toBe(false);
  });

  it("never asks a rail for a zero-amount charge", () => {
    const paypal = settlementAmount({ ...PLAN, currency: "KES", priceMonthly: 0 }, "monthly", "paypal");
    expect(paypal.amount).toBeGreaterThan(0);
  });

  it("uses the yearly price when the cycle is yearly", () => {
    vi.stubEnv("MPESA_KES_PER_USD", "100");
    expect(settlementAmount(PLAN, "yearly", "daraja").amount).toBe(5000);
    expect(settlementAmount(PLAN, "yearly", "paypal").amount).toBe(50);
  });

  it("falls back to a sane rate when the env is nonsense", () => {
    vi.stubEnv("MPESA_KES_PER_USD", "not-a-number");
    expect(kesPerUsd()).toBe(129);
  });
});

describe("provider references", () => {
  it("prefixes the reference with the rail and never repeats", () => {
    const refs = new Set(Array.from({ length: 50 }, () => newReference("daraja")));
    expect(refs.size).toBe(50);
    for (const r of refs) expect(r.startsWith("daraja-")).toBe(true);
  });

  it("recognises a prisma unique violation and nothing else", () => {
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
    expect(isUniqueViolation({ code: "P2025" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe("paypal webhooks", () => {
  it("refuses to verify a webhook that is missing a transmission header", () => {
    const request = new Request("https://example.com/api/payments/paypal/webhook", {
      method: "POST",
      headers: { "paypal-transmission-id": "abc" },
    });
    // Without all five headers there is nothing to verify against, so the route
    // must reject rather than treat an anonymous POST as a paid plan.
    expect(paypalWebhookHeaders(request)).toBeNull();
  });

  it("reads the full header set when PayPal sends one", () => {
    const request = new Request("https://example.com/api/payments/paypal/webhook", {
      method: "POST",
      headers: {
        "paypal-transmission-id": "abc",
        "paypal-transmission-time": "2026-09-14T09:00:00Z",
        "paypal-cert-url": "https://api.paypal.com/cert",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-transmission-sig": "sig",
      },
    });
    expect(paypalWebhookHeaders(request)?.transmissionId).toBe("abc");
  });

  it("maps paypal subscription states onto our vocabulary", () => {
    expect(mapPaypalSubscriptionStatus("ACTIVE")).toBe("active");
    expect(mapPaypalSubscriptionStatus("SUSPENDED")).toBe("past_due");
    expect(mapPaypalSubscriptionStatus("CANCELLED")).toBe("cancelled");
    expect(mapPaypalSubscriptionStatus("EXPIRED")).toBe("cancelled");
  });
});

describe("callback gates", () => {
  const request = (url: string) => new Request(url, { method: "POST" });

  it("accepts every callback when no shared secret is configured", () => {
    expect(darajaCallbackTokenOk(request("https://example.com/api/payments/daraja/callback"))).toBe(true);
  });

  it("requires the configured secret in the callback URL", () => {
    vi.stubEnv("MPESA_CALLBACK_TOKEN", "s3cret");
    expect(
      darajaCallbackTokenOk(request("https://example.com/api/payments/daraja/callback?token=s3cret"))
    ).toBe(true);
    expect(darajaCallbackTokenOk(request("https://example.com/api/payments/daraja/callback"))).toBe(false);
    expect(
      darajaCallbackTokenOk(request("https://example.com/api/payments/daraja/callback?token=wrong"))
    ).toBe(false);
    vi.unstubAllEnvs();
  });

  it("leaves IP allowlisting off unless it is explicitly asked for", () => {
    // The intent match is the real authorisation; an allowlist that silently
    // rejects Safaricom would break payments the moment their pool changes.
    expect(darajaCallbackIpAllowed("203.0.113.9")).toBe(true);
    vi.stubEnv("MPESA_CALLBACK_IP_CHECK", "on");
    expect(darajaCallbackIpAllowed("203.0.113.9")).toBe(false);
    expect(darajaCallbackIpAllowed("196.201.214.200")).toBe(true);
    vi.unstubAllEnvs();
  });
});

describe("billing windows", () => {
  it("normalises unknown cycles to monthly", () => {
    expect(normalizeCycle("yearly")).toBe("yearly");
    expect(normalizeCycle("weekly")).toBe("monthly");
    expect(normalizeCycle(undefined)).toBe("monthly");
  });

  it("rolls a monthly window forward by one month", () => {
    const { start, end } = periodWindow("monthly", new Date("2026-01-15T00:00:00Z"));
    expect(end.getMonth()).toBe(1); // February
    expect(end.getFullYear()).toBe(2026);
    expect(start.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});
