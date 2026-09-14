// One-off physical-state check (Stripe pipeline). Writes JSON to $PHYS_OUT.
const { PrismaClient } = require("@prisma/client");
const { writeFileSync } = require("node:fs");

const OUT = process.env.PHYS_OUT ?? "physcheck.json";

(async () => {
  const p = new PrismaClient();
  try {
    const stripeEv = await p.$queryRawUnsafe(
      `select count(*)::int as n from information_schema.tables
       where table_schema='public' and table_name='StripeEvent'`
    );
    const cols = await p.$queryRawUnsafe(
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='SubscriptionPlan'
         and column_name in ('stripePriceMonthlyId','stripePriceAnnualId')`
    );
    const mig = await p.$queryRawUnsafe(
      `select finished_at::text as f, rolled_back_at::text as rb from public."_prisma_migrations"
       where migration_name='20260912120000_stripe_pipeline'`
    );
    writeFileSync(
      OUT,
      JSON.stringify({
        stripeEventTable: stripeEv[0] ? stripeEv[0].n : 0,
        stripeCols: cols.map((c) => c.column_name),
        migRow: mig[0] || null,
      }) + "\n",
      "utf8"
    );
  } catch (e) {
    writeFileSync(OUT, JSON.stringify({ err: String(e && e.message ? e.message : e).slice(0, 300) }) + "\n", "utf8");
  } finally {
    await p.$disconnect();
  }
})();
