// Byte-safe: confirm NEW _prisma_migrations finished_at for stripe_pipeline (CJS).
"use strict";
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.env.CHECK_OUT;
const worker = String.raw`
const { PrismaClient } = require("@prisma/client");
const { writeFileSync } = require("node:fs");
const OUT = process.env.CHECK_OUT;
(async () => {
  const p = new PrismaClient();
  try {
    const row = await p.$queryRawUnsafe(
      \`select migration_name, finished_at::text as finished_at, rolled_back_at::text as rolled_back_at
       from public."_prisma_migrations"
       where migration_name='20260912120000_stripe_pipeline'\`);
    writeFileSync(OUT, JSON.stringify({ ok: true, finished_at: row[0] ? row[0].finished_at : null, rolled_back_at: row[0] ? row[0].rolled_back_at : null }) + "\\n", "utf8");
  } catch (e) {
    writeFileSync(OUT, JSON.stringify({ ok: false, err: String(e && e.message ? e.message : e).slice(0, 400) }) + "\\n", "utf8");
  } finally {
    await p.$disconnect();
  }
})();
`;
writeFileSync(JOIN_OUT, worker, "utf8");
const r = spawnSync(process.execPath, [JOIN_OUT], {
  cwd: "E:\\dev.nyash\\connectplus",
  encoding: "utf8",
  timeout: 120000,
  env: { ...process.env, CHECK_OUT: OUT },
});
writeFileSync(OUT + ".rc", String(r.status), "utf8");
