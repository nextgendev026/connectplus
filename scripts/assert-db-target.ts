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
 * Usage:
 *   ts-node --project scripts/tsconfig.script.json scripts/assert-db-target.ts "deploy migrations"
 *
 * Exit codes: 0 = safe to continue, 1 = refuse.
 */

import {
  ACTIVE_PROJECT_REF,
  LEGACY_PROJECT_REF,
  classifyDatabaseUrl,
} from "../src/lib/db-target";

const action = process.argv[2] ?? "continue";

const targets: [name: string, value: string | undefined][] = [
  ["DATABASE_URL", process.env.DATABASE_URL],
  ["DIRECT_URL", process.env.DIRECT_URL],
];

let refused = false;

for (const [name, value] of targets) {
  if (!value) {
    console.log(`[db-guard] ${name} is not set at all.`);
    continue;
  }
  const verdict = classifyDatabaseUrl(value);
  if (!verdict.ok) {
    console.error(`[db-guard] REFUSING to ${action}: ${name} → ${verdict.reason}`);
    refused = true;
    continue;
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

if (refused) {
  console.error(
    `\n[db-guard] Stopped before ${action}. The legacy project (${LEGACY_PROJECT_REF}) is read-only ` +
      `and holds the only copy of the real data. Point DATABASE_URL and DIRECT_URL at the active ` +
      `project (${ACTIVE_PROJECT_REF}) and try again. See AGENTS.md.`
  );
  process.exit(1);
}

console.log(`[db-guard] Safe to ${action}.`);
