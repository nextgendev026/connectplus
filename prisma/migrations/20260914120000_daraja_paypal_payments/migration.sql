-- Replace Stripe with the East African payment rails: Safaricom Daraja (M-Pesa)
-- and PayPal. Stripe never served Kenya, so the columns and the event ledger are
-- re-modelled provider-neutrally rather than left behind as dead weight.
--
-- DEPLOY ORDER MATTERS. `npm run vercel-build` runs `prisma migrate deploy`
-- *during* the build, while the previous deployment is still serving traffic —
-- and that deployment reads the Stripe columns this file drops. For the length
-- of one build, the pricing page, settings and the admin subscriptions console
-- will error on the old code.
--
-- If that window is unacceptable, deploy in two passes instead:
--   1. apply everything except the ALTER ... DROP COLUMN / DROP TABLE at the end
--      (comment them out), deploy the new code, let it take traffic;
--   2. re-enable those statements and run `prisma migrate deploy` again.
-- Extra columns are invisible to Prisma, so the intermediate state is safe.

-- AlterTable: SubscriptionPlan — provider price ids are per-rail now.
ALTER TABLE "SubscriptionPlan"
DROP COLUMN IF EXISTS "stripePriceMonthlyId",
DROP COLUMN IF EXISTS "stripePriceYearlyId",
ADD COLUMN "paypalPlanMonthlyId" TEXT,
ADD COLUMN "paypalPlanYearlyId" TEXT;

-- AlterTable: UserSubscription — which rail collected the money.
ALTER TABLE "UserSubscription"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN "providerSubscriptionId" TEXT,
ADD COLUMN "providerCustomerId" TEXT,
ADD COLUMN "lastPaymentRef" TEXT,
ADD COLUMN "lastPaymentAt" TIMESTAMP(3),
ADD COLUMN "payerPhone" TEXT;

-- Preserve the history before the old columns go: a membership that was being
-- billed by Stripe is still a Stripe membership, and saying "manual" would make
-- it look comped in the console.
UPDATE "UserSubscription"
SET "provider" = 'stripe',
    "providerSubscriptionId" = "stripeSubscriptionId",
    "providerCustomerId" = "stripeCustomerId"
WHERE "stripeSubscriptionId" IS NOT NULL;

ALTER TABLE "UserSubscription"
DROP COLUMN IF EXISTS "stripeSubscriptionId",
DROP COLUMN IF EXISTS "stripeCustomerId";

-- CreateTable: one attempt to buy a paid plan.
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL DEFAULT 'monthly',
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "listAmount" DOUBLE PRECISION,
    "listCurrency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "checkoutUrl" TEXT,
    "providerOrderId" TEXT,
    "providerRequestId" TEXT,
    "providerReceipt" TEXT,
    "payerPhone" TEXT,
    "failureReason" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentIntent_reference_key" ON "PaymentIntent"("reference");
CREATE INDEX "PaymentIntent_userId_status_idx" ON "PaymentIntent"("userId", "status");
CREATE INDEX "PaymentIntent_provider_status_idx" ON "PaymentIntent"("provider", "status");
CREATE INDEX "PaymentIntent_providerOrderId_idx" ON "PaymentIntent"("providerOrderId");
CREATE INDEX "PaymentIntent_providerRequestId_idx" ON "PaymentIntent"("providerRequestId");
CREATE INDEX "PaymentIntent_createdAt_idx" ON "PaymentIntent"("createdAt");

-- CreateTable: idempotency ledger for inbound payment notifications.
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "handledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentEvent_eventId_key" ON "PaymentEvent"("eventId");
CREATE INDEX "PaymentEvent_provider_handledAt_idx" ON "PaymentEvent"("provider", "handledAt");

-- The Stripe ledger has no meaning without the Stripe pipeline behind it.
DROP TABLE IF EXISTS "StripeEvent";
