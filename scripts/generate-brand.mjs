// connectPlus brand assets, generated from the official artwork.
//
// The mark is a supplied illustration (sunset emblem : lion, acacia, birds)
// delivered as two lockups — one on a white plate with a dark wordmark, one on a
// dark plate with a cream wordmark. Everything the product ships is derived from
// those two files, so the app icon, the favicon, the header mark and the social
// cards can never drift apart:
//
//   • The EMBLEM (the circle, cropped out and made transparent outside it) is
//     theme-agnostic — it is the same orange disc on either surface — so it is
//     what the header, the loading screens, the auth screens and every icon use.
//   • The two LOCKUPS are kept whole, as supplied, for surfaces that have room
//     for a stacked logo (auth heroes, the install prompt) and for the plates in
//     the social cards.
//
// The supplied lockups stack the wordmark *under* the emblem, which is why the
// header keeps the emblem and sets the wordmark beside it in the app's own type:
// at a 32px header height the stacked wordmark renders about five pixels tall.
//
// Sources live in assets/brand/ (committed) rather than in anyone's Downloads
// folder, so this script is reproducible on any machine and in CI.
//
// Run: node scripts/generate-brand.mjs
import sharp from "sharp";
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
const BRAND = join(OUT, "brand");
const SRC = join(ROOT, "assets", "brand");

/** The app's dark canvas — the plate under maskable icons and iOS's opaque one. */
const PLATE = { r: 14, g: 17, b: 20, alpha: 1 }; // #0E1114, matching manifest.background_color

mkdirSync(BRAND, { recursive: true });

/* ── Geometry: find the art in a supplied square image ──────────────────────── */

/**
 * Locate the emblem and the wordmark inside a supplied lockup.
 *
 * Measured, not hard-coded: the artwork is a raster someone may re-export at a
 * different size or with different margins, and a generation script that only
 * works for one export is a script that silently ships a mis-cropped icon.
 *
 * The background is sampled from the corners (the plates are flat), rows are
 * scanned for "not background", and the runs of art give two bands: the emblem
 * and, below it, the wordmark. The emblem's circle is centred on the horizontal
 * middle of its own topmost row — which is the circle's cap, and the only part
 * of the band that is guaranteed not to include the birds drawn beside it.
 */
async function analyse(path) {
  const { data, info } = await sharp(path).raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const bg = at(2, 2);
  const isArt = (x, y) => {
    const [r, g, b] = at(x, y);
    return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 60;
  };

  const runs = [];
  let start = null;
  for (let y = 0; y < info.height; y++) {
    let count = 0;
    for (let x = 0; x < info.width; x++) if (isArt(x, y)) count++;
    if (count > 3 && start === null) start = y;
    if (count <= 3 && start !== null) {
      runs.push([start, y - 1]);
      start = null;
    }
  }
  if (start !== null) runs.push([start, info.height - 1]);
  if (runs.length < 2) throw new Error(`${path}: expected an emblem and a wordmark, found ${runs.length} band(s)`);

  const [emblem, wordmark] = runs;
  const rowSpan = (y) => {
    let min = -1;
    let max = -1;
    for (let x = 0; x < info.width; x++) {
      if (isArt(x, y)) {
        if (min < 0) min = x;
        max = x;
      }
    }
    return [min, max];
  };

  const [capMin, capMax] = rowSpan(emblem[0] + 2);
  const centreX = Math.round((capMin + capMax) / 2);
  const side = emblem[1] - emblem[0] + 1;

  let lockLeft = 1e9;
  let lockRight = -1;
  for (let y = emblem[0]; y <= wordmark[1]; y++) {
    const [min, max] = rowSpan(y);
    if (min >= 0 && min < lockLeft) lockLeft = min;
    if (max > lockRight) lockRight = max;
  }

  return {
    width: info.width,
    height: info.height,
    emblem: { left: centreX - Math.floor(side / 2), top: emblem[0], side },
    lockup: { left: lockLeft, top: emblem[0], width: lockRight - lockLeft + 1, height: wordmark[1] - emblem[0] + 1 },
    background: `#${[bg[0], bg[1], bg[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`,
  };
}

/** A transparent circle mask, inset a hair so no background fringe survives. */
function circleMask(size) {
  const r = size / 2 - Math.max(1, size * 0.004);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#ffffff"/></svg>`
  );
}

async function emblemFrom(source, size) {
  const crop = await sharp(source.path)
    .extract({ left: source.geom.emblem.left, top: source.geom.emblem.top, width: source.geom.emblem.side, height: source.geom.emblem.side })
    .resize(size, size, { fit: "cover" })
    .ensureAlpha()
    .toBuffer();
  return sharp(crop)
    .composite([{ input: circleMask(size), blend: "dest-in" }])
    .png()
    .toBuffer();
}

/* ── favicon.ico (PNG-embedded, alpha preserved) ────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function rgbaToPng(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
      raw[o + 3] = rgba[i + 3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function encodeICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const p of pngs) {
    const e = Buffer.alloc(16);
    e[0] = p.size >= 256 ? 0 : p.size;
    e[1] = p.size >= 256 ? 0 : p.size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(p.png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += p.png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.png)]);
}

/* ── Generate ──────────────────────────────────────────────────────────────── */

const light = { path: join(SRC, "logo-light.jpg"), geom: await analyse(join(SRC, "logo-light.jpg")) };
const dark = { path: join(SRC, "logo-dark.png"), geom: await analyse(join(SRC, "logo-dark.png")) };

console.log("light plate", JSON.stringify(light.geom));
console.log("dark plate ", JSON.stringify(dark.geom));

for (const [name, source] of [["light", light], ["dark", dark]]) {
  // The lockup, trimmed to the art and scaled to the size it is displayed at.
  // The supplied files are 1024-1200px squares weighing ~350kB each, which is
  // the wrong asset to hand an install prompt that draws it at 160px.
  const png = await sharp(source.path)
    .extract(source.geom.lockup)
    .resize({ height: 320, fit: "inside" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(BRAND, `lockup-${name}.png`), png);
  console.log(`wrote brand/lockup-${name}.png`, `${source.geom.lockup.width}x${source.geom.lockup.height}`);
}

// The emblem, from the higher-resolution source, at every size the product needs.
const master = await emblemFrom(dark, 1024);
// 256 is enough for the largest place the mark is drawn (a 44px boot screen on a
// 2x display) and a fraction of the weight of the source resolution.
writeFileSync(join(BRAND, "mark.png"), await sharp(master).resize(256, 256).png({ compressionLevel: 9 }).toBuffer());
// Full resolution is only needed by the social cards and story images.
writeFileSync(join(BRAND, "mark-1024.png"), await sharp(master).png({ compressionLevel: 9 }).toBuffer());
console.log("wrote brand/mark.png (256), brand/mark-1024.png");

const ICONS = {
  "icon-16.png": 16,
  "icon-32.png": 32,
  "icon-48.png": 48,
  "icon-180.png": 180,
  "pwa-192.png": 192,
  "pwa-512.png": 512,
};
for (const [file, size] of Object.entries(ICONS)) {
  writeFileSync(join(OUT, file), await sharp(master).resize(size, size).png({ compressionLevel: 9 }).toBuffer());
  console.log("wrote", file);
}

// Maskable: Android scoots the icon into an inner circle, so the emblem renders
// at 70% on the dark plate the manifest declares as the background.
const MARK_RATIO = 0.7;
for (const [file, size] of [
  ["pwa-512-maskable.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  const inner = Math.round(size * (file.includes("maskable") ? MARK_RATIO : 0.86));
  const mark = await sharp(master).resize(inner, inner).png().toBuffer();
  writeFileSync(
    join(OUT, file),
    await sharp({ create: { width: size, height: size, channels: 4, background: PLATE } })
      .composite([{ input: mark, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toBuffer()
  );
  console.log("wrote", file);
}

// Vector favicon: the emblem embedded at 64px, so it scales crisply and is one
// request. Small enough to inline comfortably, sharp enough for a tab.
const embedded = (await sharp(master).resize(64, 64).png().toBuffer()).toString("base64");
writeFileSync(
  join(OUT, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="connectPlus">\n  <image width="64" height="64" href="data:image/png;base64,${embedded}"/>\n</svg>\n`
);
console.log("wrote favicon.svg");

const icoPngs = [];
for (const size of [16, 32, 48]) {
  const png = await sharp(master).resize(size, size).png().toBuffer();
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  icoPngs.push({ size, png: rgbaToPng(size, data) });
}
writeFileSync(join(OUT, "favicon.ico"), encodeICO(icoPngs));
console.log("wrote favicon.ico");

console.log("\nAll connectPlus brand assets regenerated →", OUT);
