import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { darajaResultMessage, intentStatusForResultCode, markIntent, settleIntent } from "@/lib/payments/fulfill";
import { stkQuery } from "@/lib/payments/daraja";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("payments");

/**
 * GET /api/payments/intents/[id]
 *
 * The checkout page's status poll, and the reason an M-Pesa payer is not left
 * staring at a spinner.
 *
 * Webhooks are the authority, but they are not always *prompt*: Safaricom can
 * take several seconds after the PIN, and on a deployment that is unreachable
 * from the public internet (local dev, a preview behind auth) the callback never
 * arrives at all. So a pending Daraja intent also asks Safaricom directly —
 * `stkpushquery` answers the same question the callback would. The result is
 * settled through the same idempotent path, so a poll that lands before the
 * callback simply means the callback finds the work already done.
 *
 * Only the intent's own owner can read it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const { id } = await params;
  const intent = await prisma.paymentIntent.findUnique({ where: { id } });
  if (!intent || intent.userId !== userId) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  let status = intent.status;
  let message = intent.failureReason ?? null;
  let subscriptionId: string | null = null;

  const live = status === "pending" || status === "processing";
  const settledLongEnoughAgo = Date.now() - intent.updatedAt.getTime() > 3_000;

  if (live && intent.provider === "daraja" && intent.providerRequestId && settledLongEnoughAgo) {
    try {
      const verdict = await stkQuery(intent.providerRequestId);
      if (verdict.resultCode !== null) {
        const next = intentStatusForResultCode(Number(verdict.resultCode));
        message = darajaResultMessage(Number(verdict.resultCode), verdict.resultDesc ?? undefined);
        if (next === "succeeded") {
          const grant = await settleIntent(intent.id, {
            receipt: null,
            phone: intent.payerPhone,
            raw: verdict.raw,
          });
          status = "succeeded";
          subscriptionId = grant?.subscriptionId ?? null;
        } else {
          await markIntent(intent.id, { status: next, failureReason: message, raw: verdict.raw });
          status = next;
        }
      } else if (verdict.resultDesc) {
        message = verdict.resultDesc;
      }
    } catch (err) {
      // A failed status query is not a failed payment — never fail the intent on
      // our inability to reach Safaricom. The callback is still coming.
      log.warn("stk status query failed", {
        intentId: intent.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const fresh = await prisma.paymentIntent.findUnique({
    where: { id: intent.id },
    select: { status: true, providerReceipt: true, settledAt: true, metadata: true },
  });

  // If the callback (or a previous poll) already settled it, surface the
  // membership it produced so the UI can offer "open my plan" rather than
  // leaving the member on a success screen with nothing to click.
  if (fresh?.status === "succeeded") {
    const sub = await prisma.userSubscription.findUnique({
      where: { userId_planId: { userId, planId: intent.planId } },
      select: { id: true, status: true, currentPeriodEnd: true },
    });
    subscriptionId = sub?.id ?? null;
  }

  return NextResponse.json(
    {
      id: intent.id,
      provider: intent.provider,
      reference: intent.reference,
      status: fresh?.status ?? status,
      pending: (fresh?.status ?? status) === "pending" || (fresh?.status ?? status) === "processing",
      message,
      receipt: fresh?.providerReceipt ?? null,
      planId: intent.planId,
      billingCycle: intent.billingCycle,
      amount: intent.amount,
      currency: intent.currency,
      /** PayPal: the hosted page to navigate to, while it is still open. */
      redirectUrl: fresh?.status === "processing" ? intent.checkoutUrl : null,
      settledAt: fresh?.settledAt ?? null,
      subscriptionId,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
