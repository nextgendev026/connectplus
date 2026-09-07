// connectPlus brand asset generator using sharp (rasterizes the official emblem).
// Crops the circular emblem from logo_connected_branches.svg and emits PNG icons
// plus a UTF-8-safe favicon.ico (PNG-embedded). Run: node scripts/generate-assets.mjs
import sharp from "sharp";
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");
const SRC = join(OUT, "logo_connected_branches.svg");

// The emblem is a 175r circle centered at (360,215) → square crop (185,40) 350x350.
const EMBLEM_LEFT = 185;
const EMBLEM_TOP = 40;
const EMBLEM_SIZE = 350;

// Extra border margin (fraction of canvas) used for maskable PWA icon so the
// roundel doesn't get clipped by the adaptive-icon safe zone.
const MASKABLE_MARGIN = 0.08;

mkdirSync(OUT, { recursive: true });

async function renderEmblem(size, { maskable = false } = {}) {
  const left = EMBLEM_LEFT;
  const top = EMBLEM_TOP;
  const size0 = EMBLEM_SIZE;
  // To keep the emblem radius constant relative to the plate, expand the crop
  // by the same fraction for maskable so the roundel stays inside safe zone.
  const cropSize = Math.round(size0 * (1 + (maskable ? MASKABLE_MARGIN * 2 : 0)));
  const cx0 = left + size0 / 2;
  const cy0 = top + size0 / 2;
  const cropLeft = Math.round(cx0 - cropSize / 2);
  const cropTop = Math.round(cy0 - cropSize / 2);

  let chip = sharp(SRC, { density: 300 });
  chip = chip.extract({
    left: cropLeft,
    top: cropTop,
    width: cropSize,
    height: cropSize,
  });
  // Decode at the requested output size.
  const buf = await chip.resize(size, size, { fit: "fill" }).png().toBuffer();

  if (maskable) {
    // Emit a solid-color plate with the emblem centered, plus head room.
    // Use a cream plate to match the logo background.
    const plate = await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 245, g: 240, b: 230, alpha: 1 },
      },
    })
      .composite([{ input: buf, gravity: "center" }])
      .png()
      .toBuffer();
    return plate;
  }
  return buf;
}

async function toPng(size, opts = {}) {
  return renderEmblem(size, opts);
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
  writeFileSync(join(OUT, file), await toPng(size));
  console.log("wrote", file);
}

writeFileSync(join(OUT, "pwa-512-maskable.png"), await toPng(512, { maskable: true }));
console.log("wrote pwa-512-maskable.png");

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
  // Decode sharp PNG buffer -> raw RGBA for the ICO encoder.
  const png = await toPng(sz);
  const { data } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  icoPngs.push({ size: sz, png: rgbaToPng(sz, data) });
}
writeFileSync(join(OUT, "favicon.ico"), encodeICO(icoPngs));
console.log("wrote favicon.ico");

console.log("All connectPlus brand assets regenerated →", OUT);
