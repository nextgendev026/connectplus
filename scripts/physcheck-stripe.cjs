// Byte-safe physical reconciliation of stripe_pipeline objects on NEW.
// Writes ONLY via node fs (byte-faithful). No CLI mutations here.
"use strict";
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.env.PHYS_OUT;
const CWD = "E:\\dev.nyash\\connectplus";

const worker = String.raw`
const { PrismaClient } = require("@prisma/client");
const { writeFileSync } = require("node:fs");
const OUT = process.env.PHYS_OUT;
(async () => {
  const p = new PrismaClient();
  try {
    const stripe_ev = await p.$queryRawUnsafe(
      \`select count(*)::int as n from information_schema.tables
       where table_schema='public' and table_name='StripeEvent'\`);
    const cols = await p.$queryRawUnsafe(
      \`select column_name from information_schema.columns
       where table_schema='public' and table_name='SubscriptionPlan'
         and column_name in ('stripePriceMonthlyId','stripePriceAnnualId')\`);
    const mig = await p.$queryRawUnsafe(
      \`select finished_at::text as f, rolled_back_at::text as rb from public."_prisma_migrations"
       where migration_name='20260912120000_stripe_pipeline'\`);
    writeFileSync(OUT, JSON.stringify({
      stripeEventTable: stripe_ev[0] ? stripe_ev[0].n : 0,
      stripeCols: cols.map(c => c.column_name),
      migRow: mig[0] || null,
    }) + "\n", "utf8");
  } catch (e) {
    writeFileSync(OUT, JSON.stringify({ err: String(e && e.message ? e.message : e).slice(0,300) }) + "\n", "utf8");
  } finally {
    await p.$disconnect();
  }
})();
`;

writeFileSync(join(__dirname, "_physcheck.cjs"), worker, "utf8");
const r = spawnSync(process.execPath, [join(__dirname, "_physcheck.cjs")], {
  cwd: CWD,
  encoding: "utf8",
  timeout: 120000,
  env: { ...process.env, PHYS_OUT: OUT },
});
writeFileSync(OUT + ".rc", String(r.status) + "\n", "utf8");
console.log("rc=" + r.status);
