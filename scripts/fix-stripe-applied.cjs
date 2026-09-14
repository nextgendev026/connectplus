// Byte-safe: run prisma migrate resolve --applied stripe_pipeline, capture output via node fs.
"use strict";
const { spawnSync } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const OUT = process.env.FIX_OUT;
const CWD = "E:\\dev.nyash\\connectplus";
const CLI = join(CWD, "node_modules", "prisma", "build", "index.js");
const NAME = "20260912120000_stripe_pipeline";

const r = spawnSync(process.execPath, [CLI, "migrate", "resolve", "--applied", NAME], {
  cwd: CWD,
  encoding: "utf8",
  timeout: 180000,
  env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
});

const payload = JSON.stringify({
  rc: r.status,
  timedOut: r.error ? String(r.error).slice(0, 200) : null,
  stdout: String(r.stdout || "").slice(0, 2500),
  stderr: String(r.stderr || "").slice(0, 2500),
}) + "\n";

writeFileSync(OUT, payload, "utf8");
console.log("done rc=" + r.status);
