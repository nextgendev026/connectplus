// OLD->NEW data copy (dependency-ordered, byte-safe, idempotent).
//
// Reads OLD (legacy, read-only, data lives here) through the Supabase Management API
// (needs OLD account PAT; never stored/committed - supplied at runtime via env OLD_PAT).
// Writes NEW (current/live source of truth, .env DATABASE_URL) through the repo Prisma
// client using createMany + skipDuplicates so re-running never duplicates or fails.
//
// Secrets: OLD_PAT comes from env var only. It is not written to any file or the log.
// The Management API call is the only OLD access (no LEGACY_DATABASE_URL needed).
//
// Dependency order (parents before children so FKs resolve):
//   seed/settings -> users -> taxonomy -> posts -> comments/likes -> rss -> neural memory
import { PrismaClient } from "@prisma/client";
import { writeFileSync, appendFileSync } from "node:fs";

const LOG = process.env.COPY_LOG || "copy.log.jsonl";
const OLD_PAT = process.env.OLD_PAT;
const OLD_PROJECT = process.env.OLD_PROJECT_REF;
if (!OLD_PAT) throw new Error("OLD_PAT env required");
if (!OLD_PROJECT) throw new Error("OLD_PROJECT_REF env required");

const enc = new TextEncoder();
const write = (obj) => appendFileSync(LOG, enc.encode(JSON.stringify(obj) + "\n"));

const SUPABASE_API = "https://api.supabase.com";

async function oldQuery(sql) {
  const res = await fetch(`${SUPABASE_API}/v1/projects/${OLD_PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OLD_PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OLD query ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

const prisma = new PrismaClient();
const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1501);

// OLD table -> { model, orderBy, where?, skipEmpty }
const PLAN = [
  { table: "SubscriptionPlan", model: "subscriptionPlan", orderBy: "id" },
  { table: "User", model: "user", orderBy: "id" },
  { table: "UserPreference", model: "userPreference", orderBy: "id" },
  { table: "UserSubscription", model: "userSubscription", orderBy: "id" },
  { table: "Category", model: "category", orderBy: "id" },
  { table: "Tag", model: "tag", orderBy: "id" },
  { table: "Post", model: "post", orderBy: "id" },
  { table: "PostEmbedding", model: "postEmbedding", orderBy: "id" },
  { table: "Comment", model: "comment", orderBy: "id" },
  { table: "Like", model: "like", orderBy: "id" },
  { table: "Follow", model: "follow", orderBy: "id" },
  { table: "Bookmark", model: "bookmark", orderBy: "id" },
  { table: "RssFeed", model: "rssFeed", orderBy: "id" },
  { table: "RssArticle", model: "rssArticle", orderBy: "id" },
  { table: "NeuralConversation", model: "neuralConversation", orderBy: "id" },
  { table: "NeuralMessage", model: "neuralMessage", orderBy: "id" },
  { table: "NeuralMemory", model: "neuralMemory", orderBy: "id" },
  { table: "ModelFeedback", model: "modelFeedback", orderBy: "id" },
  { table: "Notification", model: "notification", orderBy: "id" },
  { table: "PageView", model: "pageView", orderBy: "id" },
  { table: "PlatformSetting", model: "platformSetting", orderBy: "id" },
];

async function syncTable(step) {
  const t = step;
  try {
    const rows = await oldQuery(`select * from public."${t.table}" order by id`);
    if (!Array.isArray(rows)) throw new Error("non-array response");
    write({ t: t.table, action: "read", n: rows.length });
    if (rows.length === 0) return;
    const model = prisma[t.model];
    if (!model) throw new Error(`no prisma model ${t.model}`);
    const res = await model.createMany({ data: rows, skipDuplicates: true });
    write({ t: t.table, action: "written", n: res.count, total: rows.length });
  } catch (e) {
    write({ t: t.table, action: "ERR", err: String(e && e.message ? e.message : e).slice(0, 300) });
  }
}

async function main() {
  write({ begin: true, old: OLD_PROJECT, at: new Date().toISOString() });
  for (const step of PLAN) {
    // split large tables into chunks of 500 rows to be safe with createMany limits
    const t = step;
    try {
      const rows = await oldQuery(`select * from public."${t.table}" order by id`);
      write({ t: t.table, action: "read", n: rows ? rows.length : 0 });
      if (!rows || rows.length === 0) continue;
      const model = prisma[t.model];
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const res = await model.createMany({ data: chunk, skipDuplicates: true });
        write({ t: t.table, action: "chunk", from: i, n: chunk.length, written: res.count });
      }
    } catch (e) {
      write({ t: t.table, action: "ERR", err: String(e && e.message ? e.message : e).slice(0, 300) });
    }
  }
}

// Post->Tag implicit m2m copied via raw SQL through prisma (works for _PostToTag).
async function syncPostToTag() {
  try {
    const rows = await oldQuery(`select "A","B" from public."_PostToTag" order by "B"`);
    write({ t: "_PostToTag", action: "read", n: rows.length });
    if (!rows.length) return;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const vals = chunk
        .map((r, j) => `('${r.A}', '${r.B}')`)
        .join(",");
      const sql = `insert into public."_PostToTag" ("A","B") values ${vals} on conflict do nothing`;
      const r = await prisma.$executeRawUnsafe(sql);
      inserted += r;
    }
    write({ t: "_PostToTag", action: "written", n: inserted, total: rows.length });
  } catch (e) {
    write({ t: "_PostToTag", action: "ERR", err: String(e && e.message ? e.message : e).slice(0, 300) });
  }
}

const payload = PLAN.map(({ table }) => table);
write({ order: payload });

// Run tables with data first, then the M2M (needs both Post and Tag present).
await main();
await syncPostToTag();

await prisma.$disconnect();
write({ done: true, at: new Date().toISOString() });
