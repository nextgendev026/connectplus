#!/usr/bin/env node
/**
 * Backfill-optimize images that were stored before the optimizer existed.
 *
 * The upload pipeline now optimizes every new image, but everything stored
 * earlier — and every cover that arrived from a publisher's feed — is still at
 * full size. This walks the references we own, re-encodes each one with the same
 * presets the live engine uses, stores the smaller version and repoints the row
 * at it. It prints (and writes) the bytes saved.
 *
 *   node scripts/backfill-images.mjs                 # dry run, report only
 *   node scripts/backfill-images.mjs --apply         # re-encode and repoint
 *   node scripts/backfill-images.mjs --kind=avatar   # just avatars
 *   node scripts/backfill-images.mjs --limit=50      # cap the work
 *   node scripts/backfill-images.mjs --include-remote # also pull covers off
 *                                                     # publishers' CDNs into our
 *                                                     # storage (see the licence
 *                                                     # note below)
 *
 * What it will NOT touch: generated `/api/thumb/…` covers (nothing to optimize),
 * `data:` URIs, and — by default — remote publisher images. Re-hosting someone
 * else's photo changes who serves it and is a licensing question, not a
 * performance one, so it is opt-in.
 *
 * Dry run is the default on purpose: the `--apply` path rewrites database rows
 * and uploads new objects, which is not something a script should do because you
 * forgot a flag.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

const require = createRequire(import.meta.url);

/* ── env ──────────────────────────────────────────────────────────────────── */

function loadEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();
if (process.env.DIRECT_URL) process.env.DATABASE_URL = process.env.DIRECT_URL;

/* ── args ─────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const APPLY = has("--apply");
const KIND = valueOf("kind", "all");
const LIMIT = Number.parseInt(valueOf("limit", "500"), 10) || 500;
const INCLUDE_REMOTE = has("--include-remote");

/* ── presets (mirrors src/lib/image-optimizer.ts) ─────────────────────────── */

const PRESETS = {
  cover: { maxWidth: 1200, maxHeight: 630, quality: 82, format: "webp" },
  avatar: { maxWidth: 256, maxHeight: 256, quality: 80, format: "webp" },
};

/** Only rewrite when the win is real; a 2% saving is not worth churning a URL. */
const MIN_GAIN = 0.1;

async function optimize(input, preset) {
  const meta = await sharp(input).metadata();
  const needsResize = (meta.width ?? 0) > preset.maxWidth || (meta.height ?? 0) > preset.maxHeight;
  let pipeline = sharp(input, { failOn: "none" });
  if (needsResize) {
    pipeline = pipeline.resize({
      width: preset.maxWidth,
      height: preset.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  if (preset.sharpen && needsResize) pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.3, m2: 0.8 });
  const buffer = await pipeline.webp({ quality: preset.quality, effort: 4 }).toBuffer();
  const outMeta = await sharp(buffer).metadata();
  return { buffer, width: outMeta.width ?? 0, height: outMeta.height ?? 0, bytes: buffer.length };
}

/* ── storage ──────────────────────────────────────────────────────────────── */

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "uploads";
const SUPABASE_HOST = (() => {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).host : null;
  } catch {
    return null;
  }
})();

async function store(buffer, kind, ownerId) {
  const filename = `${randomUUID()}.webp`;
  if (SUPABASE_URL && SUPABASE_KEY) {
    const objectKey = `${kind}/${ownerId}/${filename}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${objectKey}`, {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "image/webp" },
      body: buffer,
    });
    if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${(await res.text()).slice(0, 160)}`);
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${objectKey}`;
  }
  const dir = path.join(process.cwd(), "public", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${filename}`;
}

function classify(url) {
  if (!url) return "empty";
  if (url.startsWith("data:")) return "inline";
  if (url.startsWith("/api/thumb/")) return "generated";
  if (url.startsWith("/uploads/")) return "local";
  try {
    if (SUPABASE_HOST && new URL(url).host === SUPABASE_HOST) return "supabase";
  } catch {
    return "invalid";
  }
  return "remote";
}

async function fetchBytes(url, storageClass) {
  if (storageClass === "local") {
    const rel = url.replace(/^\//, "");
    const abs = path.join(process.cwd(), "public", rel);
    if (!fs.existsSync(abs)) throw new Error("local file missing");
    return fs.readFileSync(abs);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) throw new Error(`not an image (${type})`);
  return Buffer.from(await res.arrayBuffer());
}

/* ── run ──────────────────────────────────────────────────────────────────── */

const prisma = new (require("@prisma/client").PrismaClient)();
const report = [];
const stats = { examined: 0, candidates: 0, optimized: 0, bytesBefore: 0, bytesAfter: 0, skipped: 0, failed: 0 };

function wanted(kind) {
  return KIND === "all" || KIND === kind;
}

async function handle({ table, id, field, url, kind, preset, ownerId }) {
  stats.examined++;
  const storageClass = classify(url);
  const eligible =
    storageClass === "supabase" ||
    storageClass === "local" ||
    (storageClass === "remote" && INCLUDE_REMOTE);
  if (!eligible) {
    stats.skipped++;
    return;
  }

  try {
    const before = await fetchBytes(url, storageClass);
    const after = await optimize(before, preset);
    const gain = before.length > 0 ? 1 - after.bytes / before.length : 0;

    stats.candidates++;
    stats.bytesBefore += before.length;
    stats.bytesAfter += after.bytes;

    if (gain < MIN_GAIN) {
      stats.skipped++;
      report.push({ table, id, field, kind, status: "already-small", before: before.length, after: after.bytes });
      return;
    }

    if (!APPLY) {
      report.push({
        table,
        id,
        field,
        kind,
        status: "would-optimize",
        before: before.length,
        after: after.bytes,
        savingPercent: Math.round(gain * 100),
      });
      stats.optimized++;
      return;
    }

    const newUrl = await store(after.buffer, kind, ownerId);
    if (table === "post") {
      await prisma.post.update({ where: { id }, data: { coverImage: newUrl } });
    } else {
      await prisma.user.update({ where: { id }, data: { avatar: newUrl } });
    }
    report.push({
      table,
      id,
      field,
      kind,
      status: "optimized",
      before: before.length,
      after: after.bytes,
      savingPercent: Math.round(gain * 100),
      from: url,
      to: newUrl,
    });
    stats.optimized++;
  } catch (error) {
    stats.failed++;
    report.push({ table, id, field, kind, status: "failed", error: String(error).slice(0, 160), url });
  }
}

async function main() {
  console.log(`Image backfill — ${APPLY ? "APPLY" : "DRY RUN"} · kind=${KIND} · limit=${LIMIT}${INCLUDE_REMOTE ? " · include-remote" : ""}`);
  console.log(SUPABASE_URL ? `Storage: Supabase (${SUPABASE_HOST})` : "Storage: local ./public/uploads");

  if (wanted("cover")) {
    const posts = await prisma.post.findMany({
      where: { coverImage: { not: null } },
      select: { id: true, coverImage: true, authorId: true },
      take: LIMIT,
    });
    for (const p of posts) {
      await handle({
        table: "post",
        id: p.id,
        field: "coverImage",
        url: p.coverImage,
        kind: "cover",
        preset: { ...PRESETS.cover, sharpen: true },
        ownerId: p.authorId,
      });
    }
  }

  if (wanted("avatar")) {
    const users = await prisma.user.findMany({
      where: { avatar: { not: null } },
      select: { id: true, avatar: true },
      take: LIMIT,
    });
    for (const u of users) {
      await handle({
        table: "user",
        id: u.id,
        field: "avatar",
        url: u.avatar,
        kind: "avatar",
        preset: { ...PRESETS.avatar, sharpen: false },
        ownerId: u.id,
      });
    }
  }

  const saved = stats.bytesBefore - stats.bytesAfter;
  const percent = stats.bytesBefore > 0 ? Math.round((saved / stats.bytesBefore) * 100) : 0;

  console.log("");
  console.log(`Examined           ${stats.examined}`);
  console.log(`Candidates         ${stats.candidates}`);
  console.log(`Optimized          ${stats.optimized}`);
  console.log(`Skipped            ${stats.skipped}`);
  console.log(`Failed             ${stats.failed}`);
  console.log(`Bytes before       ${stats.bytesBefore.toLocaleString()}`);
  console.log(`Bytes after        ${stats.bytesAfter.toLocaleString()}`);
  console.log(`Saved              ${saved.toLocaleString()} (${percent}%)`);
  if (!APPLY) console.log("\nDry run — nothing was written. Re-run with --apply to repoint the rows.");

  const outDir = path.join(process.cwd(), "reports");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `image-backfill-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ applied: APPLY, kind: KIND, stats, percent, report }, null, 2));
  console.log(`Report written to ${path.relative(process.cwd(), outFile)}`);
}

main()
  .catch((error) => {
    console.error("backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
