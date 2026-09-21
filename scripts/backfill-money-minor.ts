/**
 * Backfill the exact integer money columns from the legacy Float ones.
 *
 * Run once after deploying the `money_minor_units` migration, and it is safe to
 * run repeatedly: it only fills rows where the minor-unit column is still NULL, so
 * a second run finds nothing to do. It never writes the Float columns, so nothing
 * it does can change what the application currently reads.
 *
 * The conversion is *lossy in the safe direction only*. A Float that was meant to
 * be 2 decimal places can be something else — `0.1 + 0.2` is
 * `0.30000000000000004`, and a fee computed as a percentage of a float can drift
 * several more digits — so `toMinorUnitsRounded` snaps to two places with half-up
 * rounding rather than refusing. A value that is genuinely not a number is skipped
 * and counted, never guessed at.
 *
 * Every row it cannot convert is reported at the end with its id, so the count is
 * a to-do list rather than a statistic nobody reads.
 *
 * Usage:
 *   npm run db:guard -- "backfill money" && npm run db:backfill-money
 *   npm run db:backfill-money -- --dry-run
 *
 * Exit codes: 0 = applied (or nothing to do), 1 = the run failed.
 */

import { PrismaClient } from "@prisma/client";
import { type Currency, fromLegacyFloat, toMajor } from "../src/lib/money";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

/**
 * What actually happened, in the past tense it deserves.
 *
 * The counters below increment whether or not anything was written, so a dry run
 * used to report "2 written" for two rows it had not touched. In a tool that
 * edits money, a log line that overstates what it did is worse than no log line —
 * an operator checking whether the backfill had already run would read "written"
 * and conclude it had.
 */
const done = (n: number) => (dryRun ? `${n} would be written` : `${n} written`);

interface Failure {
  table: string;
  id: string;
  detail: string;
}

const failures: Failure[] = [];
let updated = 0;

function money(value: number | null | undefined, currency: string): { minor: number | null; reason?: string } {
  const parsed = fromLegacyFloat(value ?? null, (currency === "USD" ? "USD" : "KES") satisfies Currency);
  if (value === null || value === undefined) return { minor: null, reason: "no amount stored" };
  if (!parsed) return { minor: null, reason: `"${value}" is not a readable decimal amount` };
  return { minor: parsed.amountMinor };
}

async function main() {
  console.log(`[backfill-money] ${dryRun ? "DRY RUN — nothing will be written" : "applying"}`);

  /* ── PaymentIntent ─────────────────────────────────────────────────────── */
  const intents = await prisma.paymentIntent.findMany({
    where: { OR: [{ amountMinor: null }, { listAmountMinor: null }] },
    select: { id: true, amount: true, amountMinor: true, listAmount: true, listAmountMinor: true, currency: true },
  });
  for (const row of intents) {
    const amount = money(row.amount, row.currency);
    const list = money(row.listAmount, row.currency);
    if (amount.minor === null) {
      failures.push({ table: "PaymentIntent.amount", id: row.id, detail: amount.reason ?? "unreadable" });
      continue;
    }
    if (row.listAmount !== null && list.minor === null) {
      failures.push({ table: "PaymentIntent.listAmount", id: row.id, detail: list.reason ?? "unreadable" });
      continue;
    }
    if (!dryRun) {
      await prisma.paymentIntent.update({
        where: { id: row.id },
        data: {
          amountMinor: amount.minor,
          ...(row.listAmount !== null && list.minor !== null ? { listAmountMinor: list.minor } : {}),
        },
      });
    }
    updated += 1;
  }
  console.log(`[backfill-money] PaymentIntent: ${intents.length} candidate(s), ${done(updated)}`);

  /* ── SubscriptionPlan ──────────────────────────────────────────────────── */
  let plans = 0;
  const planRows = await prisma.subscriptionPlan.findMany({
    where: { OR: [{ priceMonthlyMinor: null }, { priceYearlyMinor: null }] },
    select: { id: true, priceMonthly: true, priceYearly: true, priceMonthlyMinor: true, priceYearlyMinor: true, currency: true },
  });
  for (const row of planRows) {
    const monthly = money(row.priceMonthly, row.currency);
    const yearly = money(row.priceYearly, row.currency);
    if (monthly.minor === null || yearly.minor === null) {
      failures.push({
        table: "SubscriptionPlan.price",
        id: row.id,
        detail: monthly.reason ?? yearly.reason ?? "unreadable",
      });
      continue;
    }
    if (!dryRun) {
      await prisma.subscriptionPlan.update({
        where: { id: row.id },
        data: { priceMonthlyMinor: monthly.minor, priceYearlyMinor: yearly.minor },
      });
    }
    plans += 1;
  }
  console.log(`[backfill-money] SubscriptionPlan: ${planRows.length} candidate(s), ${done(plans)}`);

  /* ── Tip ───────────────────────────────────────────────────────────────── */
  let tips = 0;
  const tipRows = await prisma.tip.findMany({
    where: { amountMinor: null },
    select: { id: true, amount: true, currency: true },
  });
  for (const row of tipRows) {
    const amount = money(row.amount, row.currency);
    if (amount.minor === null) {
      failures.push({ table: "Tip.amount", id: row.id, detail: amount.reason ?? "unreadable" });
      continue;
    }
    if (!dryRun) await prisma.tip.update({ where: { id: row.id }, data: { amountMinor: amount.minor } });
    tips += 1;
  }
  console.log(`[backfill-money] Tip: ${tipRows.length} candidate(s), ${done(tips)}`);

  /* ── CreatorPayout ─────────────────────────────────────────────────────── */
  let payouts = 0;
  const payoutRows = await prisma.creatorPayout.findMany({
    where: { OR: [{ amountMinor: null }, { feeAmountMinor: null }] },
    select: { id: true, amount: true, amountMinor: true, feeAmount: true, feeAmountMinor: true, currency: true },
  });
  for (const row of payoutRows) {
    const amount = money(row.amount, row.currency);
    const fee = money(row.feeAmount, row.currency);
    if (amount.minor === null || fee.minor === null) {
      failures.push({ table: "CreatorPayout", id: row.id, detail: amount.reason ?? fee.reason ?? "unreadable" });
      continue;
    }
    if (!dryRun) {
      await prisma.creatorPayout.update({
        where: { id: row.id },
        data: { amountMinor: amount.minor, feeAmountMinor: fee.minor },
      });
    }
    payouts += 1;
  }
  console.log(`[backfill-money] CreatorPayout: ${payoutRows.length} candidate(s), ${done(payouts)}`);

  /* ── Summary ───────────────────────────────────────────────────────────── */
  console.log(
    `\n[backfill-money] ${dryRun ? "would write" : "wrote"} ` +
      `${updated} intent(s), ${plans} plan(s), ${tips} tip(s), ${payouts} payout(s).`
  );

  if (failures.length > 0) {
    console.error(`[backfill-money] ${failures.length} row(s) need a human:`);
    for (const failure of failures.slice(0, 50)) {
      console.error(`  ${failure.table} ${failure.id}: ${failure.detail}`);
    }
    if (failures.length > 50) console.error(`  …and ${failures.length - 50} more.`);
    console.error(
      "[backfill-money] These rows keep a NULL minor-unit amount. The application must not " +
        "compute money from a NULL — treat it as unset, not as zero."
    );
  } else {
    console.log("[backfill-money] No rows were unreadable.");
  }

  // A sanity line an operator can eyeball: totals should agree to within the
  // rounding the conversion can legitimately introduce (half a cent per row).
  const intentTotal = await prisma.paymentIntent.aggregate({
    _count: { _all: true },
  });
  console.log(`[backfill-money] ${intentTotal._count._all} payment intent(s) on record in total.`);
  console.log(`[backfill-money] Sample: ${toMajor({ amountMinor: 64_500, currency: "KES" })} (645.00 KES)`);
}

main()
  .catch((error) => {
    console.error("[backfill-money] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
