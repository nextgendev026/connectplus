import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import {
  clientIp,
  darajaCallbackIpAllowed,
  darajaCallbackTokenOk,
  parseStkCallback,
} from "@/lib/payments/daraja";
import {
  darajaResultMessage,
  findIntent,
  intentStatusForResultCode,
  markIntent,
  settleIntent,
} from "@/lib/payments/fulfill";
import { isUniqueViolation } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("payments");

/**
 * POST /api/payments/daraja/callback — Safaricom's STK result.
 *
 * This endpoint is public by necessity, so it is written as if everything in the
 * body is hostile:
 *
 *   1. **The body carries no identity.** It names a `CheckoutRequestID` and
 *      nothing else. We only act if that id matches a `PaymentIntent` *we*
 *      created — a forged callback cannot name an intent it has never seen, and
 *      a member cannot pay for someone else's plan.
 *   2. **A zero ResultCode is not a payment.** It must come with an
 *      `MpesaReceiptNumber`, and the amount must match what we asked for. A
 *      "success" with no receipt or the wrong amount is refused and logged.
 *   3. **Replays are absorbed.** The claim row is inserted first, so the same
 *      callback delivered twice settles one membership exactly once.
 *   4. Optional defence in depth: `MPESA_CALLBACK_TOKEN` (shared secret in the
 *      callback URL) and `MPESA_CALLBACK_IP_CHECK=on` with `MPESA_ALLOWED_IPS`.
 *
 * A 200 means "stop retrying"; a 500 means "we could not process this, try
 * again" — the ledger row is released in that case so the retry can succeed.
 */
export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  if (!darajaCallbackTokenOk(request)) {
    log.warn("daraja callback rejected: bad token", { ip });
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 401 });
  }
  if (!darajaCallbackIpAllowed(ip)) {
    log.warn("daraja callback rejected: source not allowlisted", { ip });
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Rejected" }, { status: 403 });
  }

  const payload = await request.json().catch(() => null);
  const callback = parseStkCallback(payload);
  if (!callback) {
    // Not a shape we recognise. Acknowledge so Safaricom stops retrying, but say
    // so in the logs — this is how a Daraja API change announces itself.
    log.warn("daraja callback with unrecognised body", { ip, payload });
    return NextResponse.json({ ResultCode: 0, ResultDesc: "Ignored" });
  }

  const eventId = `daraja:${callback.checkoutRequestId}`;
  try {
    await prisma.paymentEvent.create({
      data: { eventId, provider: "daraja", type: `stk.result.${callback.resultCode}` },
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ ResultCode: 0, ResultDesc: "Already processed" });
    }
    log.error("daraja callback ledger write failed", { eventId, error: String(err) });
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Ledger unavailable" }, { status: 500 });
  }

  try {
    const intent = await findIntent({ providerRequestId: callback.checkoutRequestId });
    if (!intent) {
      // Either a callback for a request we never made, or one whose intent was
      // pruned. Either way there is nothing to grant — and looking it up failed
      // loudly is better than guessing.
      log.warn("daraja callback for unknown request", {
        checkoutRequestId: callback.checkoutRequestId,
        resultCode: callback.resultCode,
        receipt: callback.receipt,
      });
      return NextResponse.json({ ResultCode: 0, ResultDesc: "No matching payment" });
    }

    const message = darajaResultMessage(callback.resultCode, callback.resultDesc);
    const status = intentStatusForResultCode(callback.resultCode);

    if (status === "succeeded") {
      // The receipt is the proof of payment. Without it there is nothing here
      // but a code we cannot independently verify, and a "success" carrying no
      // receipt is exactly what a forged callback would look like.
      if (!callback.receipt) {
        log.error("daraja callback reported success without a receipt — refusing to grant", {
          intentId: intent.id,
          checkoutRequestId: callback.checkoutRequestId,
        });
        await markIntent(intent.id, {
          status: "failed",
          failureReason: "Safaricom reported success without a receipt number.",
          raw: callback.raw,
        });
        return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      // Amount check: the STK push fixed the amount, so a different one means the
      // payload was not produced by that request.
      if (callback.amount != null && Math.abs(callback.amount - intent.amount) > 1) {
        log.error("daraja callback amount mismatch — refusing to grant", {
          intentId: intent.id,
          expected: intent.amount,
          received: callback.amount,
          receipt: callback.receipt,
        });
        await markIntent(intent.id, {
          status: "failed",
          failureReason: `Amount mismatch: expected ${intent.amount} ${intent.currency}, received ${callback.amount}.`,
          raw: callback.raw,
        });
        return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
      }

      const grant = await settleIntent(intent.id, {
        receipt: callback.receipt,
        phone: callback.phone,
        raw: callback.raw,
      });
      log.info("mpesa payment settled", {
        intentId: intent.id,
        receipt: callback.receipt,
        planId: intent.planId,
        periodEnd: grant?.periodEnd.toISOString(),
      });
    } else {
      await markIntent(intent.id, { status, failureReason: message, phone: callback.phone, raw: callback.raw });
      log.info("mpesa payment not completed", {
        intentId: intent.id,
        resultCode: callback.resultCode,
        status,
      });
    }

    return NextResponse.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    // Release the claim so Safaricom's retry can process this properly.
    await prisma.paymentEvent.deleteMany({ where: { eventId } }).catch(() => {});
    log.error("daraja callback handler failed", { eventId, error: String(err) });
    return NextResponse.json({ ResultCode: 1, ResultDesc: "Processing failed" }, { status: 500 });
  }
}

/** Safaricom sometimes probes the callback URL before registering it. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "daraja-stk-callback" });
}
