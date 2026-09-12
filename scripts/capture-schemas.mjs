// Byte-true dual-schema capture: OLD (Management API) + NEW (direct pg via DATABASE_URL).
// Writes one JSONL per side to files given as argv[2]/argv[3]. Node-fs is the ONLY writer
// (channel-independent); the read tool then reproduces it byte-true.
//
// Usage:
//   OLD_PAT=... OLD_PROJECT=eligxvxirkfnqqkywxhv DATABASE_URL=... \
//     node scripts/capture-schemas.mjs old-schema.jsonl new-schema.jsonl

import { writeFileSync, appendFileSync } from "node:fs";
import pg from "pg";

const [OLD_SCHEMA, NEW_SCHEMA] = process.argv.slice(2);
const PAT = process.env.OLD_PAT;
const OLD_PROJ = process.env.OLD_PROJECT || "eligxvxirkfnqqkywxhv";
const NEW_URL = process.env.DATABASE_URL;
if (!PAT || !NEW_URL) throw new Error("OLD_PAT + DATABASE_URL required");
if (!OLD_SCHEMA || !NEW_SCHEMA) throw new Error("argv: old-schema-file new-schema-file");

const out = (f, o) => appendFileSync(f, JSON.stringify(o) + "\n", "utf8");

async function management(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${OLD_PROJ}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`MGMT ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

const qInfo = (capitalize) => `
select table_name, column_name, ordinal_position, data_type, udt_name, is_nullable,
  column_default, character_maximum_length
from information_schema.columns c
where c.table_schema='public'
order by table_name, ordinal_position`;

const qEnum = `
select t.typname, e.enumlabel
from pg_type t
join pg_enum e on e.enumtypid = t.oid
order by t.typname, e.enumsortorder`;

(async () => {
  // OLD
  try {
    const cols = await management(qInfo);
    const enums = await management(qEnum);
    out(OLD_SCHEMA, { kind: "cols", rows: cols });
    out(OLD_SCHEMA, { kind: "enums", rows: enums });
    out(OLD_SCHEMA, { kind: "done" });
  } catch (e) {
    out(OLD_SCHEMA, { kind: "ERR", err: String(e && e.message ? e.message : e).slice(0, 500) });
  }
  // NEW via direct pg
  try {
    const c = new pg.Client({ connectionString: NEW_URL, ssl: { rejectUnauthorized: false } });
    await c.connect();
    const cols = await c.query({ text: qInfo, rowMode: "array" });
    const colFields = cols.fields.map((f) => f.name);
    const colRows = cols.rows.map((r) => Object.fromEntries(colFields.map((f, i) => [f, r[i]])));
    const enums = await c.query({ text: qEnum, rowMode: "array" });
    const enumFields = enums.fields.map((f) => f.name);
    const enumRows = enums.rows.map((r) => Object.fromEntries(enumFields.map((f, i) => [f, r[i]])));
    out(NEW_SCHEMA, { kind: "cols", rows: colRows });
    out(NEW_SCHEMA, { kind: "enums", rows: enumRows });
    out(NEW_SCHEMA, { kind: "done" });
    await c.end();
  } catch (e) {
    out(NEW_SCHEMA, { kind: "ERR", err: String(e && e.message ? e.message : e).slice(0, 500) });
  }
})();
