-- Money as integers.
--
-- Every monetary column on this platform was a Float, which is not a
-- representation of money: 0.1 + 0.2 is not 0.3, a percentage of a float drifts
-- further per row, and — the case that matters — the Daraja callback *compares* a
-- provider's declared amount against the intent we created, where a
-- representation error is a legitimate payment refused or a wrong payment
-- accepted.
--
-- This migration is purely additive and deliberately dormant:
--
--   * Every new column is NULLABLE. A NOT NULL needs a default, and any default
--     here would be a guess about money. The old Float columns stay authoritative
--     until the backfill has run and the writers have moved over.
--   * Nothing reads the new columns yet, so deploying this cannot change any
--     behaviour. The application populates them via `src/lib/money.ts` and
--     `scripts/backfill-money-minor.ts`.
--   * Dropping the old columns is a *later*, separate migration, after a release
--     in which both were written and compared. Rollback before then is
--     `ALTER TABLE … DROP COLUMN` on the columns below, which loses no data
--     because the Float values they mirror are untouched.
--
-- The CHECK constraints are not modelled by Prisma (its schema language has no
-- way to express them), so `prisma migrate diff` will neither create nor drop
-- them. They are intentional and are documented here and in docs/PHASE-E-NOTES.md.

-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN "amountMinor" INTEGER;
ALTER TABLE "PaymentIntent" ADD COLUMN "listAmountMinor" INTEGER;

-- AlterTable
ALTER TABLE "SubscriptionPlan" ADD COLUMN "priceMonthlyMinor" INTEGER;
ALTER TABLE "SubscriptionPlan" ADD COLUMN "priceYearlyMinor" INTEGER;

-- AlterTable
ALTER TABLE "Tip" ADD COLUMN "amountMinor" INTEGER;

-- AlterTable
ALTER TABLE "CreatorPayout" ADD COLUMN "amountMinor" INTEGER;
ALTER TABLE "CreatorPayout" ADD COLUMN "feeAmountMinor" INTEGER;

-- A count of minor units cannot be negative, and a "valid currency" is one of the
-- two rails this platform can settle. Both are stated in the database rather than
-- only in TypeScript, because the nightly jobs, the backfill script and psql are
-- all writers too.
ALTER TABLE "PaymentIntent"
  ADD CONSTRAINT "PaymentIntent_amountMinor_nonnegative"
  CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0);
ALTER TABLE "PaymentIntent"
  ADD CONSTRAINT "PaymentIntent_currency_known"
  CHECK ("currency" IN ('KES', 'USD'));

ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_priceMinor_nonnegative"
  CHECK (
    ("priceMonthlyMinor" IS NULL OR "priceMonthlyMinor" >= 0)
    AND ("priceYearlyMinor" IS NULL OR "priceYearlyMinor" >= 0)
  );

ALTER TABLE "Tip"
  ADD CONSTRAINT "Tip_amountMinor_nonnegative"
  CHECK ("amountMinor" IS NULL OR "amountMinor" >= 0);
ALTER TABLE "Tip"
  ADD CONSTRAINT "Tip_currency_known"
  CHECK ("currency" IN ('KES', 'USD'));

ALTER TABLE "CreatorPayout"
  ADD CONSTRAINT "CreatorPayout_amounts_nonnegative"
  CHECK (
    ("amountMinor" IS NULL OR "amountMinor" >= 0)
    AND ("feeAmountMinor" IS NULL OR "feeAmountMinor" >= 0)
  );
-- Deliberately *not* constrained here, having tried:
--
--   `feeAmountMinor <= amountMinor` looks like an obvious sanity rule, and it is
--   wrong. `amount` is the net sent to the creator and `feeAmount` is the share
--   withheld, so gross = net + fee; a platform share above 50% gives a fee that
--   exceeds the net, which is a legitimate commercial arrangement and not a
--   corrupt row. A CHECK that refuses valid data is worse than no CHECK, because
--   the failure appears during a real payout rather than at review time.
--
--   `payout <= available balance` is a cross-row invariant (it needs the creator's
--   unsettled tips to evaluate), so it belongs in the payout service, where it can
--   be checked under the same transaction that consumes the balance. Phase N.
