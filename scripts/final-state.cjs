// Current-state query for stripe_pipeline row on NEW (byte-safe, node fs output).
"use strict";
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");
const OUT = process.env.FINAL_OUT;

const worker = String.raw`
const { PrismaClient } = require("@prisma/client");
const { writeFileSync } = require("node:fs");
(async () => {
  const p = new PrismaClient();
  try {
    const row = await p.$queryRawUnsafe(
      \`select migration_name,
             started_at::text as started_at,
             finished_at::text as finished_at,
             rolled_back_at::text as rolled_back_at
       from public."_prisma_migrations"
       where migration_name = '20260912120000_stripe_pipeline'\`);
    writeFileSync(process.env.FINAL_OUT, JSON.stringify({ rc: 0, row: row[0] || null }) + "\n", "utf8");
  } catch (e) {
    writeFileSync(process.env.FINAL_OUT, JSON.stringify({ rc: 1, err: String(e && e.message ? e.message : e).slice(0, 300) }) + "\n", "utf8");
  } finally {
    await p.$disconnect();
  }
})();
`;

const r = spawnSync(process.execPath, ["-e", worker], {
  cwd: "E:\\dev.nyash\\connectplus",
  encoding: "utf8",
  timeout: 120000,
  env: { ...process.env, FINAL_OUT: OUT },
});
writeFileSync(OUT + ".rc", String(r.status), "utf8");
console.log("wrote");
