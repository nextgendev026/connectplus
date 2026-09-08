// connectPlus brand asset generator using sharp.
// Renders the official connectPlus mark (the amber→rose gradient squircle with
// the rounded "network plus" — same art as components/ui/ConnectPlusMark.tsx)
// and emits every PNG icon plus favicon.svg and a PNG-embedded favicon.ico.
// Run: node scripts/generate-assets.mjs
import sharp from "sharp";
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

// ── Official mark (viewBox 0 0 120 120) ─────────────────────────────────────
const MARK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
  <defs>
    <linearGradient id="cp-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFD75E"/>
      <stop offset="35%" stop-color="#FBBF24"/>
      <stop offset="70%" stop-color="#F97316"/>
      <stop offset="100%" stop-color="#F43F5E"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="112" height="112" rx="30" fill="url(#cp-g)"/>
  <circle cx="38" cy="32" r="46" fill="#ffffff" opacity="0.12"/>
  <rect x="9" y="9" width="102" height="102" rx="26" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="1.5"/>
  <rect x="52" y="30" width="16" height="60" rx="8" fill="#ffffff"/>
  <rect x="30" y="52" width="60" height="16" rx="8" fill="#ffffff"/>
  <circle cx="60" cy="24" r="4.2" fill="#ffffff"/>
  <circle cx="60" cy="96" r="4.2" fill="#ffffff"/>
  <circle cx="24" cy="60" r="4.2" fill="#ffffff"/>
  <circle cx="96" cy="60" r="4.2" fill="#ffffff"/>
  <path d="M88 28 l2.3 5.4 5.4 2.3 -5.4 2.3 -2.3 5.4 -2.3 -5.4 -5.4 -2.3 5.4 -2.3 Z" fill="#ffffff" opacity="0.92"/>
</svg>`;

// Brand dark surface — matches manifest background_color for the maskable plate.
const PLATE_BG = { r: 10, g: 10, b: 13, alpha: 1 };

// Maskable safety: Android scoots the icon into an inner 80% circle, so render
// the mark at 70% and center it on the dark chrome plate.
const MASKABLE_SCALE = 0.7;

mkdirSync(OUT, { recursive: true });

async function renderMark(size, { maskable = false } = {}) {
  if (maskable) {
    const markSize = Math.round(size * MASKABLE_SCALE);
    const chip = await sharp(Buffer.from(MARK_SVG))
      .resize(markSize, markSize)
      .png()
      .toBuffer();
    return sharp({
      create: { width: size, height: size, channels: 4, background: PLATE_BG },
    })
      .composite([{ input: chip, gravity: "center" }])
      .png()
      .toBuffer();
  }
  return sharp(Buffer.from(MARK_SVG)).resize(size, size).png().toBuffer();
}

const SIZES = {
  "icon-16.png": 16,
  "icon-32.png": 32,
  "icon-48.png": 48,
  "icon-180.png": 180,
  "pwa-192.png": 192,
  "pwa-512.png": 512,
};

for (const [file, size] of Object.entries(SIZES)) {
  writeFileSync(join(OUT, file), await renderMark(size));
  console.log("wrote", file);
}

writeFileSync(join(OUT, "pwa-512-maskable.png"), await renderMark(512, { maskable: true }));
console.log("wrote pwa-512-maskable.png");

// Apple touch icon (180px, no transparency) — same mark.
writeFileSync(join(OUT, "apple-touch-icon.png"), await renderMark(180));
console.log("wrote apple-touch-icon.png");

// Vector favicon — crisp at any size, used by modern browsers.
writeFileSync(join(OUT, "favicon.svg"), MARK_SVG);
console.log("wrote favicon.svg");

// ── favicon.ico (PNG-embedded) ───────────────────────────────────────────────
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

const icoPngs = [];
for (const sz of [16, 32, 48]) {
  const png = await renderMark(sz);
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  icoPngs.push({ size: sz, png: rgbaToPng(sz, data) });
}
writeFileSync(join(OUT, "favicon.ico"), encodeICO(icoPngs));
console.log("wrote favicon.ico");

console.log("All connectPlus brand assets regenerated →", OUT);