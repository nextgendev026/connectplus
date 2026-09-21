/**
 * Refuse to touch the legacy database.
 *
 * Run in front of every migration command, and inside `vercel-build` ahead of
 * `prisma migrate deploy`. Exits non-zero rather than warning: a migration aimed
 * at the OLD project would not fail, it would succeed — altering the schema of the
 * read-only source of real historical data. There is no safe "warn and continue"
 * here, because the failure is silent and the damage is to the copy the platform
 * cannot regenerate.
 *
 * Checks `DIRECT_URL` as well as `DATABASE_URL`: Prisma applies migrations over
 * the direct connection, so the two can differ, and a guard that inspected only
 * one of them would be a guard with a hole in the exact place it matters.
 *
 * ── Two bugs in the first version, both of which made it useless ───────────
 *
 * 1. **It could not see the database.** The script read `process.env` only, but
 *    `npm run db:guard` runs under a shell where `.env` has not been exported —
 *    Prisma's CLI loads that file itself, which is why `prisma migrate status`
 *    connected successfully while this guard reported that `DATABASE_URL` "is not
 *    set at all". Both statements were true, about different things.
 *
 * 2. **It failed open.** Having failed to find a URL, it logged a note, skipped
 *    the check with `continue`, and then printed "Safe to deploy migrations." So
 *    the guard approved every run in which it had learned nothing — the exact
 *    situation it existed to catch. Not being able to see the target is not
 *    evidence that the target is correct.
 *
 * The lesson both share: a safety check must fail closed, and must be verified in
 * the environment it actually runs in rather than the one it was tested in.
 *
 * Usage:
 *   ts-node --project scripts/tsconfig.script.json scripts/assert-db-target.ts "deploy migrations"
 *
 * Exit codes: 0 = safe to continue, 1 = refuse.
 */

import { existsSync } from "node:fs";
import { config as loadEnvFile } from "dotenv";

import {
  ACTIVE_PROJECT_REF,
  LEGACY_PROJECT_REF,
  classifyDatabaseUrl,
} from "../src/lib/db-target";

// Load the same files, in the same precedence, that Next and Prisma use — `.env`
// first and `.env.local` overriding it. Anything already set in the real
// environment wins over both, which is what a CI or Vercel run needs.
for (const file of [".env", ".env.local"]) {
  if (existsSync(file)) loadEnvFile({ path: file, override: false, quiet: true });
}

const action = process.argv[2] ?? "continue";

const databaseUrl = process.env.DATABASE_URL;

/**
 * Fail closed.
 *
 * Without a URL there is nothing to classify, so there is nothing to approve.
 */
if (!databaseUrl) {
  console.error(
    `[db-guard] REFUSING to ${action}: DATABASE_URL is not set.\n` +
      `[db-guard] Looked in the environment, .env and .env.local.\n` +
      `[db-guard] An unreadable target is not a safe target — this guard cannot ` +
      `confirm the database is the active project (${ACTIVE_PROJECT_REF}), so it will not continue.`
  );
  process.exit(1);
}

let refused = false;

/** Classify one connection string, refusing anything that is not the active project. */
function check(name: string, value: string | undefined): void {
  if (!value) {
    // A missing DIRECT_URL is legitimate: Prisma falls back to DATABASE_URL.
    if (name === "DIRECT_URL") console.log(`[db-guard] ${name} not set — using DATABASE_URL.`);
    return;
  }
  const verdict = classifyDatabaseUrl(value);
  if (!verdict.ok) {
    console.error(`[db-guard] REFUSING to ${action}: ${name} → ${verdict.reason}`);
    refused = true;
    return;
  }
  if (verdict.kind === "active") {
    console.log(`[db-guard] ${name} → active project ${ACTIVE_PROJECT_REF}.`);
  } else {
    console.log(
      `[db-guard] ${name} → ${verdict.ref ?? "no project ref found"} ` +
        `(neither the active nor the legacy project — a local or CI database).`
    );
  }
}

check("DATABASE_URL", databaseUrl);
check("DIRECT_URL", process.env.DIRECT_URL);

if (refused) {
  console.error(
    `\n[db-guard] Stopped before ${action}. The legacy project (${LEGACY_PROJECT_REF}) is read-only ` +
      `and holds the only copy of the real data. Point DATABASE_URL and DIRECT_URL at the active ` +
      `project (${ACTIVE_PROJECT_REF}) and try again. See AGENTS.md.`
  );
  process.exit(1);
}

console.log(`[db-guard] Safe to ${action}.`);
