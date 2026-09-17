// connectPlus social share cards (Open Graph / Twitter) at the 1200×630 the
// platforms actually ask for.
//
// The default share image used to be `/pwa-512.png` — the square app icon —
// while the metadata declared it as 1200×630. A square declared as a landscape
// card is letterboxed, cropped, or ignored outright, so the single most-shared
// surface of the whole product was an icon on a plain square.
//
// Uses the official emblem (public/brand/mark.png), so the card and the app show
// the same mark. Run scripts/generate-brand.mjs first — it produces that file.
//
// Run: node scripts/generate-og.mjs
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public");

const W = 1200;
const H = 630;

/** The official emblem, composited rather than redrawn. */
const MARK_SIZE = 108;
const MARK = await sharp(join(OUT, "brand", "mark.png")).resize(MARK_SIZE, MARK_SIZE).png().toBuffer();

function escapeXml(input) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One chip: a rounded pill with a label, measured generously to fit the text. */
function chip({ x, y, label, tone }) {
  const width = 26 + label.length * 11.4;
  return {
    width,
    svg: `
    <rect x="${x}" y="${y}" width="${width}" height="42" rx="21" fill="${tone.fill}" stroke="${tone.stroke}" stroke-width="1.5"/>
    <text x="${x + width / 2}" y="${y + 28}" text-anchor="middle" font-family="Segoe UI, Inter, Arial, Helvetica, sans-serif" font-size="20" font-weight="600" fill="${tone.text}">${escapeXml(label)}</text>`,
  };
}

/**
 * The card layout. One column of left-aligned type with a lot of air: at the
 * ~500px wide a messenger renders this, 64px type is ~27px and the headline is
 * still the first thing read.
 */
function card({ eyebrow, headline, sub, chips = [], accent, domain }) {
  const tones = {
    amber: { fill: "rgba(245,158,11,0.12)", stroke: "rgba(245,158,11,0.35)", text: "#F5C87A" },
    emerald: { fill: "rgba(16,185,129,0.12)", stroke: "rgba(16,185,129,0.35)", text: "#7FE0BB" },
  };

  let chipX = 72;
  const chipSvg = chips
    .map((label) => {
      const { svg, width } = chip({ x: chipX, y: 536, label, tone: tones[accent.chipTone ?? "amber"] });
      chipX += width + 12;
      return svg;
    })
    .join("");

  const headlineSvg = headline
    .map(
      (line, index) =>
        `<text x="72" y="${318 + index * 74}" font-family="Segoe UI, Inter, Arial, Helvetica, sans-serif" font-size="64" font-weight="800" fill="#FFFFFF" letter-spacing="-1.5">${escapeXml(line)}</text>`
    )
    .join("");

  const subSvg = sub
    .map(
      (line, index) =>
        `<text x="72" y="${452 + index * 36}" font-family="Segoe UI, Inter, Arial, Helvetica, sans-serif" font-size="27" font-weight="400" fill="#C7C0B4">${escapeXml(line)}</text>`
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFD75E"/>
      <stop offset="38%" stop-color="#F59E0B"/>
      <stop offset="72%" stop-color="#C2410C"/>
      <stop offset="100%" stop-color="#7C2D12"/>
    </linearGradient>
    <linearGradient id="rule" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${accent.from}"/>
      <stop offset="100%" stop-color="${accent.to}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${accent.from}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${accent.from}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#C2410C" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#C2410C" stop-opacity="0"/>
    </radialGradient>
    <!--
      Scrim over the glow.

      The warm wash is the brand, but it was covering the type as well: the
      headline sat on a mid-tone brown and the whole card read as a muddy
      rectangle at messenger size. The glow is pushed to the right-hand third and
      this gradient holds the left column at the deep charcoal the type needs, so
      contrast belongs to the layout rather than to whatever colour the gradient
      happens to be at that x.
    -->
    <linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#0E1114" stop-opacity="0.96"/>
      <stop offset="46%" stop-color="#0E1114" stop-opacity="0.82"/>
      <stop offset="72%" stop-color="#0E1114" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#0E1114"/>
  <ellipse cx="1060" cy="600" rx="520" ry="400" fill="url(#glowA)"/>
  <ellipse cx="1120" cy="30" rx="440" ry="300" fill="url(#glowB)"/>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>

  <text x="200" y="106" font-family="Segoe UI, Inter, Arial, Helvetica, sans-serif" font-size="42" font-weight="800" fill="#FFF9F0" letter-spacing="-0.5">connectPlus</text>
  <text x="202" y="142" font-family="Segoe UI, Inter, Arial, Helvetica, sans-serif" font-size="19" font-weight="600" fill="#F0A94B" letter-spacing="2.6">${escapeXml(eyebrow)}</text>

  ${headlineSvg}
  ${subSvg}

  <rect x="72" y="508" width="1056" height="2" fill="url(#rule)"/>
  ${chipSvg}
  <text x="1128" y="566" text-anchor="end" font-family="Segoe UI, Inter, Arial, Helvetica, sans-serif" font-size="22" font-weight="600" fill="#8A8578">${escapeXml(domain)}</text>
</svg>`;
}

mkdirSync(OUT, { recursive: true });

const CARDS = {
  // The site-wide default: what a pasted home-page or marketing link renders as.
  "og-default.png": card({
    eyebrow: "STORIES · LIVE SCORES · RADIO",
    headline: ["East Africa's stories,", "live scores & radio."],
    sub: ["Journalism, livescores and 40+ stations in one place.", "Homegrown voices, in full."],
    chips: ["Kenya", "Uganda", "Tanzania", "Rwanda"],
    accent: { from: "#F59E0B", to: "#F59E0B" },
    domain: "connectplusapp.vercel.app",
  }),
  // The sports desk. Carries the model's own terms — actionable picks and the
  // record — because that is the argument the board makes.
  "og-tips.png": card({
    eyebrow: "MODEL PICKS · FOOTBALL",
    headline: ["Today's picks,", "with the reasoning."],
    sub: ["Every pick arrives with why. Only picks you can still act on.", "Model record published. 18+ — not financial advice."],
    chips: ["Live scores", "Predictions", "Fixture calendar"],
    accent: { from: "#10B981", to: "#10B981", chipTone: "emerald" },
    domain: "connectplusapp.vercel.app",
  }),
};

for (const [file, svg] of Object.entries(CARDS)) {
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  const png = await sharp(base)
    .composite([{ input: MARK, top: 58, left: 72 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(OUT, file), png);
  console.log("wrote", file, `${W}x${H}`, `${(png.length / 1024).toFixed(0)}kB`);
}
