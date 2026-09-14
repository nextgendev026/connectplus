// Byte-safe NEW migration/Stripe-state inspector. Writes a UTF-8 report via node fs
// (never stdout) so the channel can't mangle it. NO secrets, NO writes to DB.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

const prisma = new PrismaClient();
const out = [];
const enc = (s) => out.push(String(s));

try {
  const row = await prisma.$queryRaw`
    SELECT migration_name, started_at, finished_at, rolled_back_at,
           substr(coalesce(logs,'')::text,1,800) AS logs
    FROM public."_prisma_migrations"
    WHERE migration_name = '20260912120000_stripe_pipeline'`;
  enc(JSON.stringify({ q: "migration_row", row: row[0] || null }));

  let nCols = -1;
  try {
    const se = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name='StripeEvent'`;
    nCols = se[0].n;
  } catch (e) { nCols = -2; if (false) {} }
  enc(JSON.stringify({ q: "StripeEvent_table_count", n: nCols }));

  const cols = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='SubscriptionPlan'
      AND column_name IN ('stripePriceMonthlyId','stripePriceYearlyId')`;
  enc(JSON.stringify({ q: "SubscriptionPlan_stripe_cols", cols: cols.map((c) => c.column_name), n: cols.length }));
} catch (e) {
  enc(JSON.stringify({ q: "FATAL", err: String(e && e.message ? e.message : e).slice(0, 600) }));
}

writeFileSync(process.env.STRIPE_STATE_OUT, out.join("\n"), "utf8");
await prisma.$disconnect();
console.log(out.length);
