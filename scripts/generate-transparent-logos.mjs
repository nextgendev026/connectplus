/**
 * Generate transparent-background lockups from the existing artwork.
 *
 * Each lockup is the circular emblem + wordmark on a fully transparent canvas.
 * Two variants: dark wordmark (for light surfaces) and cream wordmark (for dark
 * surfaces). The emblem itself (the sunset disc) works on both because its own
 * colors span the full range.
 */
import sharp from "sharp";
import { readFileSync } from "node:fs";

const EMBLEM = "public/brand/mark.png";
const WORDMARK = "CONNECTPLUS";
const EMBLEM_SIZE = 256;
const WORDMARK_HEIGHT = 40;
const PADDING_BOTTOM = 12;
const TOTAL_HEIGHT = EMBLEM_SIZE + PADDING_BOTTOM + WORDMARK_HEIGHT;
const CANVAS_WIDTH = 400;

const VARIANTS = [
  { name: "light", fill: "#1a1a1a", output: "public/brand/lockup-transparent-light.png" },
  { name: "dark", fill: "#f7efe3", output: "public/brand/lockup-transparent-dark.png" },
];

async function main() {
  const emblemBuffer = readFileSync(EMBLEM);
  const emblemMeta = await sharp(emblemBuffer).metadata();
  console.log(`Emblem: ${emblemMeta.width}x${emblemMeta.height}`);

  const scale = Math.min(1, CANVAS_WIDTH / emblemMeta.width);
  const scaledWidth = Math.round(emblemMeta.width * scale);
  const emblemX = Math.round((CANVAS_WIDTH - scaledWidth) / 2);

  for (const v of VARIANTS) {
    const wordmarkSvg = `<svg width="${CANVAS_WIDTH}" height="${WORDMARK_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <style> text { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-weight: 900; font-size: 28px; letter-spacing: 0.08em; } </style>
      <text x="${CANVAS_WIDTH / 2}" y="${WORDMARK_HEIGHT - 8}" text-anchor="middle" fill="${v.fill}">${WORDMARK}</text>
    </svg>`;

    await sharp({
      create: {
        width: CANVAS_WIDTH,
        height: TOTAL_HEIGHT,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .composite([
        { input: emblemBuffer, left: emblemX, top: 0, blend: "over" },
        { input: Buffer.from(wordmarkSvg), left: 0, top: EMBLEM_SIZE + PADDING_BOTTOM, blend: "over" },
      ])
      .toFile(v.output);

    console.log(`Wrote ${v.output} (${CANVAS_WIDTH}x${TOTAL_HEIGHT})`);
  }
}

main().catch(console.error);
