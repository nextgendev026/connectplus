// Byte-safe: confirm NEW _prisma_migrations state for stripe_pipeline (finished_at?).
"use strict";
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.env.MIGCHECK_OUT;
const CWD = "E:\\dev.nyash\\connectplus";
const CLI = join(CWD, "node_modules", "prisma", "build", "index.js");

const checkSrc = `
const { PrismaClient } = require("@prisma/client");
const { writeFileSync } = require("node:fs");
(async () => {
  const p = new PrismaClient();
  try {
    const rows = await p.$queryRawUnsafe(
      \`select migration_name, started_at::text as s, finished_at::text as f, rolled_back_at::text as rb
       from public."_prisma_migrations"
       where migration_name = '20260912120000_stripe_pipeline'\`);
    writeFileSync(process.env.MIGCHECK_OUT, JSON.stringify(rows[0] || null) + "\\n", "utf8");
  } catch (e) {
    writeFileSync(process.env.MIGCHECK_OUT, JSON.stringify({ err: String(e && e.message ? e.message : e).slice(0, 300) }) + "\\n", "utf8");
  } finally {
    await p.$disconnect();
  }
})();
`;

const r = spawnSync(process.execPath, ["-e", checkSrc], {
  cwd: CWD,
  encoding: "utf8",
  timeout: 120000,
  env: { ...process.env, MIGCHECK_OUT: OUT },
});
writeFileSync(OUT + ".rc", String(r.status) + "\n", "utf8");
console.log("rc=" + r.status);
