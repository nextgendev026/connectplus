// Byte-safe: list ALL _prisma_migrations rows on NEW that are NOT cleanly finished
// (finished_at IS NULL OR rolled_back_at IS NOT NULL) — these are exactly what would
// abort `prisma migrate deploy` on Vercel again. Writes JSONL via node fs.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "node:fs";

interface MigrationRow {
  migration_name: string;
  started_at: string | null;
  finished_at: string | null;
  rolled_back_at: string | null;
  logs: string | null;
}

const prisma = new PrismaClient();
const out: string[] = [];
const OUT = process.env.MIG_STATUS_OUT ?? ".freebuff/mig-status.jsonl";

try {
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, started_at::text AS started_at, finished_at::text AS finished_at,
           rolled_back_at::text AS rolled_back_at,
           left(coalesce(logs::text,''),200) AS logs
    FROM public."_prisma_migrations"
    WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
    ORDER BY started_at`;
  out.push(JSON.stringify({ q: "unfinished", n: rows.length, rows }));
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  out.push(JSON.stringify({ q: "ERR", err: message.slice(0, 600) }));
}

writeFileSync(OUT, out.join("\n") + "\n", "utf8");
await prisma.$disconnect();
console.log(out.length);
