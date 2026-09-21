/**
 * Pre-flight for `20260921120000_money_minor_units`.
 *
 * The migration is additive and dormant, so deploying it cannot change what the
 * application reads or writes. What it *can* do is abort — because alongside the
 * new nullable columns it adds real CHECK constraints, and a CHECK is evaluated
 * against every existing row at the moment it is created:
 *
 *   PaymentIntent_currency_known  CHECK ("currency" IN ('KES', 'USD'))
 *   Tip_currency_known            CHECK ("currency" IN ('KES', 'USD'))
 *
 * One PaymentIntent or Tip stored with any other currency is enough for the whole
 * migration to fail. Postgres runs each migration file in a transaction, so the
 * failure is clean — nothing is half-applied — but it also means the migration is
 * left unapplied and re-running will fail identically until the data is fixed.
 * That is a bad way to find out, during a deploy, at the exact moment you least
 * want to be deciding whether it is safe to edit payment rows.
 *
 * So: ask first. Read-only, no writes, safe to run on production at any time.
 *
 * Usage:
 *   npm run db:guard -- "check the money migration" && npm run db:money-preflight
 *
 * Exit codes: 0 = the constraints will hold, 1 = some row would abort it.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** The currencies the two payment rails can actually settle. */
const SETTLEABLE = ["KES", "USD"] as const;

interface Offence {
  table: string;
  currency: string | null;
  count: number;
}

async function main() {
  console.log("[money-preflight] read-only checks for the money_minor_units migration");

  const offences: Offence[] = [];

  /* ── The two constrained tables ─────────────────────────────────────────── */

  const badIntents = await prisma.$queryRaw<{ currency: string | null; count: bigint }[]>`
    SELECT "currency", COUNT(*) AS count
    FROM "PaymentIntent"
    WHERE "currency" IS NULL OR "currency" NOT IN ('KES', 'USD')
    GROUP BY "currency"
  `;
  for (const row of badIntents) {
    offences.push({ table: "PaymentIntent", currency: row.currency, count: Number(row.count) });
  }

  const badTips = await prisma.$queryRaw<{ currency: string | null; count: bigint }[]>`
    SELECT "currency", COUNT(*) AS count
    FROM "Tip"
    WHERE "currency" IS NULL OR "currency" NOT IN ('KES', 'USD')
    GROUP BY "currency"
  `;
  for (const row of badTips) {
    offences.push({ table: "Tip", currency: row.currency, count: Number(row.count) });
  }

  /* ── Context an operator needs to judge what they are looking at ─────────── */

  // Plain counts only. This deliberately does not touch the minor-unit columns:
  // a pre-flight for a migration cannot depend on the columns that migration
  // adds, and the first version of this script failed with `column "amountMinor"
  // does not exist` — correctly, since it had not been applied yet.
  const totals = await prisma.$queryRaw<{ table: string; total: bigint }[]>`
    SELECT 'PaymentIntent' AS table, COUNT(*) AS total FROM "PaymentIntent"
    UNION ALL SELECT 'Tip', COUNT(*) FROM "Tip"
    UNION ALL SELECT 'SubscriptionPlan', COUNT(*) FROM "SubscriptionPlan"
    UNION ALL SELECT 'CreatorPayout', COUNT(*) FROM "CreatorPayout"
  `;

  console.log("\n[money-preflight] rows that will need a minor-unit amount backfilled:");
  for (const row of totals) {
    console.log(`  ${row.table.padEnd(18)} ${String(row.total).padStart(8)}`);
  }

  const legacyCurrencies = await prisma.$queryRaw<{ currency: string | null; count: bigint }[]>`
    SELECT "currency", COUNT(*) AS count FROM "PaymentIntent" GROUP BY "currency"
    UNION ALL
    SELECT "currency", COUNT(*) FROM "Tip" GROUP BY "currency"
  `;
  console.log("\n[money-preflight] every currency currently stored:");
  const seen = new Map<string, bigint>();
  for (const row of legacyCurrencies) {
    const key = row.currency ?? "(null)";
    seen.set(key, (seen.get(key) ?? BigInt(0)) + row.count);
  }
  for (const [currency, count] of seen) {
    console.log(`  ${currency.padEnd(8)} ${count}`);
  }

  if (offences.length === 0) {
    console.log(
      `\n[money-preflight] OK — every stored currency is one of ${SETTLEABLE.join(", ")}. ` +
        `The CHECK constraints will be satisfied, so the migration can apply.`
    );
    return;
  }

  console.error("\n[money-preflight] BLOCKED — the migration would abort. Rows in violation:");
  for (const offence of offences) {
    console.error(`  ${offence.table}: currency ${offence.currency ?? "(null)"} × ${offence.count}`);
  }
  console.error(
    "\n[money-preflight] A CHECK constraint is evaluated against existing rows when it is created, " +
      "so these must be corrected first. Decide per row — do NOT blanket-update a currency column, " +
      "because the stored value is the only record of what the payer was actually charged."
  );
  process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(
      "[money-preflight] could not run:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
