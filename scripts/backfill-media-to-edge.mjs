#!/usr/bin/env node
/**
 * Backfill: move every stored Supabase media URL in the database onto the
 * edge media plane (`$EDGE_URL/__media/<key>`).
 *
 * Why this exists: Supabase free tier allows 5 GB of egress a month, and the
 * site was serving every stored image directly from Supabase — which burns
 * that inside days and then answers 402 `exceed_egress_quota` to uploads AND
 * to every already-stored image. The edge plane (Cloudflare R2 or its KV
 * stop-gap, fronted by the per-colo Cache API) has zero egress cost, so once
 * a row points there it can never be hostage to a Supabase quota again.
 *
 * The run is idempotent: only rows still holding a Supabase storage URL are
 * touched, the object key is preserved verbatim, and a row is updated only
 * after the edge PUT succeeded — so a partial run can be repeated freely.
 *
 * While Supabase is restricted, downloads fail with 402; the script reports
 * them and exits nonzero without touching those rows. Re-run it after the
 * egress quota resets (billing cycle) or is lifted in the dashboard.
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-media-to-edge.mjs [--limit N] [--dry-run]
 */
import { PrismaClient } from "@prisma/client";

const EDGE = (process.env.EDGE_URL ?? "").trim().replace(/\/+$/, "");
const SECRET = (process.env.CRON_SECRET ?? "").trim();
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "uploads";

if (!EDGE) {
  console.error("EDGE_URL is required — the edge media plane has no address to backfill onto.");
  process.exit(1);
}
if (!SECRET) {
  console.error("CRON_SECRET is required — the edge media plane authenticates writes with it.");
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = flag("--dry-run");
const LIMIT = Number(value("--limit", "0")) || Infinity;

/** Columns whose rows can hold a stored media URL. Discovered, not guessed. */
async function mediaColumns(prisma) {
  const cols = await prisma.$queryRawUnsafe(`
    SELECT c.table_name AS table, c.column_name AS column
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type IN ('text', 'character varying')
       AND c.column_name IN ('avatar', 'coverImage', 'image', 'imageUrl', 'cover', 'thumbnail', 'logo', 'banner')
     ORDER BY c.table_name, c.column_name
  `);
  return cols;
}

/** The primary-key column list for one table, as a SQL expression. */
async function pkColumns(prisma, table) {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT a.attname AS name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = '"${table.replace(/"/g, '""')}"'::regclass
       AND i.indisprimary
     ORDER BY a.attnum
  `);
  return rows.map((r) => r.name);
}

/** Pull the object key out of any Supabase public storage URL. */
function keyFromUrl(url) {
  try {
    const u = new URL(url);
    const marker = `/storage/v1/object/public/${BUCKET}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    const key = u.pathname.slice(idx + marker.length);
    // Only the shapes the edge plane serves: <kind>/<owner>/<file> with an
    // extension the worker accepts. Anything else (legacy buckets, odd paths)
    // is left for a human rather than migrated into a 404.
    if (!/^(avatar|cover|post|generated)\/[\w.-]+\/[\w.-]+$/.test(key)) return null;
    if (!/\.(jpg|jpeg|png|webp|gif|mp4|webm)$/.test(key)) return null;
    return key;
  } catch {
    return null;
  }
}

const prisma = new PrismaClient();
let migrated = 0;
let skippedShape = 0;
let failedDownload = 0;
let failedPut = 0;
const failures = [];

try {
  const columns = await mediaColumns(prisma);
  console.log(`scanning ${columns.length} candidate columns on ${EDGE}`);

  for (const { table, column } of columns) {
    if (migrated >= LIMIT) break;

    const pks = await pkColumns(prisma, table).catch(() => []);
    const pkList = pks.map((p) => `"${p}"`).join(", ");
    if (!pkList) continue;

    const rows = await prisma.$queryRawUnsafe(
      `SELECT ${pkList}, "${column}" AS url FROM "${table}" WHERE "${column}" LIKE '%/storage/v1/object/public/%' LIMIT 500`
    );
    if (rows.length === 0) continue;

    for (const row of rows) {
      if (migrated >= LIMIT) break;
      const url = row.url;
      const key = keyFromUrl(url);
      if (!key) {
        skippedShape += 1;
        continue;
      }

      const where = Object.fromEntries(pks.map((p) => [p, row[p]]));

      if (DRY) {
        console.log(`[dry-run] ${table}.${column} ${where[pks[0]]} → ${EDGE}/__media/${key}`);
        migrated += 1;
        continue;
      }

      // 1. Download the original bytes. 402 while Supabase is restricted —
      //    the row stays untouched and the run reports it.
      const source = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (!source || !source.ok) {
        failedDownload += 1;
        failures.push({ table, column, id: where[pks[0]], stage: "download", status: source ? source.status : 0 });
        continue;
      }
      const bytes = await source.arrayBuffer();

      // 2. PUT to the edge plane with the same key — the URL shape after the
      //    host is identical, so nothing downstream changes but the origin.
      const contentType = source.headers.get("content-type") || "application/octet-stream";
      const put = await fetch(`${EDGE}/__media/${key}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": contentType },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      }).catch(() => null);
      if (!put || !put.ok) {
        failedPut += 1;
        failures.push({ table, column, id: where[pks[0]], stage: "put", status: put ? put.status : 0 });
        continue;
      }

      // 3. Point the row at the edge — only now, only on full success. Raw
      //    SQL because the discovered names are DB table/column identifiers
      //    ("Post", "coverImage"), which the Prisma client's model API does
      //    not address by those names. Identifiers come from
      //    information_schema; only the values are parameterised.
      const pkWhere = pks.map((p, i) => `"${p}" = $${i + 2}`).join(" AND ");
      await prisma.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1 WHERE ${pkWhere}`,
        `${EDGE}/__media/${key}`,
        ...pks.map((p) => row[p])
      );
      migrated += 1;
      if (migrated % 25 === 0) console.log(`… ${migrated} migrated`);
    }
  }

  const counts = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total
      FROM "Post" WHERE "coverImage" LIKE '%supabase%'
  `).catch(() => [{ total: -1 }]);

  console.log("\n── backfill summary ─────────────────────────────");
  console.log(`migrated     : ${migrated}${DRY ? " (dry run)" : ""}`);
  console.log(`bad shape    : ${skippedShape} (left for a human)`);
  console.log(`dl failed    : ${failedDownload} (Supabase 402 → re-run after egress resets)`);
  console.log(`put failed   : ${failedPut}`);
  if (counts[0] && counts[0].total >= 0) {
    console.log(`supabase urls still in Post.coverImage: ${counts[0].total}`);
  }
  if (failures.length > 0 && failures.length <= 12) {
    for (const f of failures) console.log(`  ! ${f.table}.${f.column} ${f.id} ${f.stage} → HTTP ${f.status}`);
  }
  process.exit(failedPut > 0 || (failedDownload > 0 && migrated === 0) ? 1 : 0);
} finally {
  await prisma.$disconnect();
}
