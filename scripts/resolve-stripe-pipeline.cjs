// Resolve the stuck stripe_pipeline migration on NEW as APPLIED.
// Its DDL (StripeEvent table + both stripe columns) is byte-verified already
// physically present on NEW; only _prisma_migrations.finished_at is NULL, which
// trips P3009 and blocks every subsequent `migrate deploy` (hence every deploy).
"use strict";
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.env.RESOLVE_OUT || join(process.env.TEMP || "/tmp", "resolve-stripe-pipeline-out.txt");
const CWD = "E:\\dev.nyash\\connectplus";
const CLI = join(CWD, "node_modules", "prisma", "build", "index.js");

const r = spawnSync(
  process.execPath,
  [CLI, "migrate", "resolve", "--applied", "20260912120000_stripe_pipeline"],
  { cwd: CWD, encoding: "utf8", timeout: 240000, env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" } }
);

writeFileSync(OUT, JSON.stringify({
  rc: r.status,
  timedOut: r.error ? String(r.error).slice(0, 200) : null,
  stdout: String(r.stdout || ""),
  stderr: String(r.stderr || ""),
}) + "\n", "utf8");
console.log("wrote rc=" + r.status);