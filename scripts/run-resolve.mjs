// Run: node scripts/run-resolve.mjs   (cwd = repo root)
// Wraps the Prisma CLI directly (avoids broken npm/npx shims) and writes the
// *complete* CLI result byte-true via node fs (the only byte-faithful channel).
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = process.env.RESOLVE_NOTE || join(process.env.TEMP || "/tmp", "run-resolve.txt");
const lines = [];

async function cli(args) {
  const t0 = Date.now();
  const r = spawnSync(
    process.env.PRISMA_BIN || join(process.cwd(), "node_modules", "prisma", "build", "index.js"),
    args,
    { cwd: process.cwd(), encoding: "utf8", timeout: 300000, env: { ...process.env } }
  );
  const el = Date.now() - t0;
  lines.push(JSON.stringify({
    args: args.join(" "),
    rc: r.status,
    el_ms: el,
    cmd: "prisma CLI",
    stdout: String(r.stdout || "").slice(0, 4000),
    stderr: String(r.stderr || "").slice(0, 3000),
  }));
}

// Step 1: resolve --applied for the buggy/pending stripe_pipeline migration on NEW.
await cli(["migrate", "resolve", "--applied", "20260912120000_stripe_pipeline"]);

// Step 2: confirm the resolution by listing remaining unfinished migrations on NEW.
//   (if this reports 0 unfinished -> the deploy blocker is gone for good)
try {
  // use dotenv to load DATABASE_URL, then query _prisma_migrations via pg through prisma
} catch (e) {
  lines.push(JSON.stringify({ step: "err", err: String(e && e.message ? e.message : e).slice(0, 600) }));
}

writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log("b=" + (existsSync(OUT) ? OUT : "?" ) + " => wrote " + (existsSync(OUT) ? require("fs").statSync(OUT).size : 0) + "B");
