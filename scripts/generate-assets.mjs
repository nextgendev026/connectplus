// Savanna logo asset generator (zero dependencies).
// Draws the "connectPlus" savanna roundel — sunset sun + acacia silhouette on
// an amber-to-terracotta gradient — and emits PNG files plus a multiplatform
// favicon.ico (PNG-embedded). Run: node scripts/generate-assets.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const SMOOTH = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function makeCanvas(size) {
  const px = new Float32Array(size * size * 4);
  return {
    size,
    px,
    paint(x, y, r, g, b, a255) {
      if (x < 0 || y < 0 || x >= size || y >= size || a255 <= 0) return;
      const i = ((y * size + x) | 0) * 4;
      const a = a255 / 255;
      const prevA = px[i + 3] / 255;
      const na = a + prevA * (1 - a);
      if (na <= 0) return;
      px[i] = (r * a + px[i] * prevA * (1 - a)) / na;
      px[i + 1] = (g * a + px[i + 1] * prevA * (1 - a)) / na;
      px[i + 2] = (b * a + px[i + 2] * prevA * (1 - a)) / na;
      px[i + 3] = na * 255;
    },
    circle(cx, cy, rad, cr, cg, cb, ca, inner = 0) {
      for (let y = Math.max(0, cy - rad - 1); y <= Math.min(size - 1, cy + rad + 1); y++) {
        for (let x = Math.max(0, cx - rad - 1); x <= Math.min(size - 1, cx + rad + 1); x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const a = SMOOTH(Math.max(inner, rad) - d + 0.5);
          if (a > 0.003) this.paint(x, y, cr, cg, cb, ca * a * 255);
        }
      }
    },
    ellipse(cx, cy, rx, ry, cr, cg, cb, ca) {
      for (let y = Math.max(0, cy - ry - 1); y <= Math.min(size - 1, cy + ry + 1); y++) {
        for (let x = Math.max(0, cx - rx - 1); x <= Math.min(size - 1, cx + rx + 1); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          const a = SMOOTH(1 - Math.sqrt(dx * dx + dy * dy) + 0.5);
          if (a > 0.003) this.paint(x, y, cr, cg, cb, ca * a * 255);
        }
      }
    },
    fillGradient() {
      const S = this.size;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const t = ((x + y) / (2 * S)) ** 0.9;
          this.paint(x, y,
            GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * t,
            GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * t,
            GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * t, 255);
        }
      }
    },
  };
}

const CHARCOAL = [26, 23, 21];
const SUN_TOP = [254, 231, 148];
const SUN_CORE = [250, 204, 84];
const GRAD_TOP = [251, 195, 48];
const GRAD_BOT = [187, 64, 20];

// Savanna sun + acacia silhouette, centered at (cx, cy) with scale radius R.
function drawArt(g, cx, cy, R) {
  // Soft halo behind the sun for depth
  g.circle(cx - R * 0.42, cy - R * 0.5, R * 0.52, SUN_TOP[0], SUN_TOP[1], SUN_TOP[2], 0.28);
  // Main sun disc
  g.circle(cx - R * 0.42, cy - R * 0.5, R * 0.42, SUN_TOP[0], SUN_TOP[1], SUN_TOP[2], 0.98);
  // Sun core (slightly deeper gold at center)
  g.circle(cx - R * 0.42, cy - R * 0.5, R * 0.26, SUN_CORE[0], SUN_CORE[1], SUN_CORE[2], 0.9);
  // "+" cut on the sun (brand mark)
  const plusX = cx - R * 0.42 + R * 0.08, plusY = cy - R * 0.5 + R * 0.08;
  const arm = R * 0.18, thick = Math.max(1, R * 0.085);
  g.ellipse(plusX, plusY, arm, thick, 244, 208, 96, 0.75);
  g.ellipse(plusX, plusY, thick, arm, 244, 208, 96, 0.75);

  // Acacia canopy (softly rounded, charcoal-black)
  const ccx = cx + R * 0.18, ccy = cy + R * 0.52;
  const leafR = R * 0.30, leafRy = R * 0.15;
  g.ellipse(ccx, ccy - R * 0.16, leafR, leafRy, CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], 1);
  g.ellipse(ccx - leafR * 0.62, ccy + R * 0.01, leafR * 0.82, leafRy * 0.95, CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], 1);
  g.ellipse(ccx + leafR * 0.62, ccy + R * 0.01, leafR * 0.82, leafRy * 0.95, CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], 1);
  g.ellipse(ccx, ccy + R * 0.18, leafR * 0.12, R * 0.32, CHARCOAL[0], CHARCOAL[1], CHARCOAL[2], 0.98);
  g.ellipse(ccx, ccy + R * 0.52, leafR * 1.46, R * 0.055, 0, 0, 0, 0.3);
}

function drawRoundel(size, { maskable = false } = {}) {
  const g = makeCanvas(size);
  const R = size * (maskable ? 0.36 : 0.46);
  if (maskable) {
    g.fillGradient(); // full-bleed plate for adaptive PWA icons
  } else {
    // gradient circle plate (rounded-roundel mark)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2);
        const a = SMOOTH(size / 2 - d + 0.5);
        if (a > 0.003) {
          const t = ((x + y) / (2 * size)) ** 0.9;
          g.paint(x, y,
            GRAD_TOP[0] + (GRAD_BOT[0] - GRAD_TOP[0]) * t,
            GRAD_TOP[1] + (GRAD_BOT[1] - GRAD_TOP[1]) * t,
            GRAD_TOP[2] + (GRAD_BOT[2] - GRAD_TOP[2]) * t, a * 255);
        }
      }
    }
  }
  drawArt(g, size / 2, size / 2, R);
  return g;
}

// ── PNG / ICO encoding ──────────────────────────────────────────────────────
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
function encodePNG(g) {
  const { size, px } = g;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(px[i]);
      raw[o + 1] = Math.round(px[i + 1]);
      raw[o + 2] = Math.round(px[i + 2]);
      raw[o + 3] = Math.round(px[i + 3]);
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
    const { size, png } = p;
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.png)]);
}

// ── Emit assets ─────────────────────────────────────────────────────────────
mkdirSync(OUT, { recursive: true });

const SIZES = {
  "icon-16.png": 16,
  "icon-32.png": 32,
  "icon-48.png": 48,
  "icon-180.png": 180,
  "pwa-192.png": 192,
  "pwa-512.png": 512,
};

for (const [file, size] of Object.entries(SIZES)) {
  writeFileSync(join(OUT, file), encodePNG(drawRoundel(size)));
  console.log("wrote", file);
}

writeFileSync(join(OUT, "pwa-512-maskable.png"), encodePNG(drawRoundel(512, { maskable: true })));
console.log("wrote pwa-512-maskable.png");

const pngs = [16, 32, 48].map(sz => ({ size: sz, png: encodePNG(drawRoundel(sz)) }));
writeFileSync(join(OUT, "favicon.ico"), encodeICO(pngs));
console.log("wrote favicon.ico");

console.log("All savanna brand assets generated →", OUT);