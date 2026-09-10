/**
 * Deterministic branded thumbnail painter shared by the /api/thumb routes.
 * All dynamic text is XML-escaped; no scripts are ever emitted, so the SVG
 * is safe to serve through the Next.js image optimizer sandbox.
 */

const PALETTES: [string, string, string][] = [
  // [from, to, accent]
  ["#F97316", "#F43F5E", "#FFD75E"],
  ["#0EA5E9", "#6366F1", "#7DD3FC"],
  ["#10B981", "#0D9488", "#6EE7B7"],
  ["#8B5CF6", "#EC4899", "#C4B5FD"],
  ["#F59E0B", "#E11D48", "#FDE68A"],
  ["#14B8A6", "#0EA5E9", "#99F6E4"],
  ["#EF4444", "#7C3AED", "#FCA5A5"],
  ["#22C55E", "#02939B", "#BBF7D0"],
];

export interface ThumbPaint {
  title: string;
  category: string;
  author: string;
  seed: string;
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapWords(value: string, maxChars = 34, maxLines = 3): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
    } else {
      current = (current + " " + word).trim();
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current.trim());
  const out = lines.slice(0, maxLines);
  if (words.join(" ").length > out.join(" ").length && out.length > 0) {
    out[out.length - 1] = `${out[out.length - 1]!.replace(/\s*\S*$/, "")}…`;
  }
  return out.filter(Boolean);
}

export function paintThumb(input: ThumbPaint): string {
  const title = input.title || "connectPlus";
  const category = input.category || "Story";
  const author = input.author || "";
  const seed = input.seed || title;

  const [from, to, accent] = PALETTES[hashString(seed) % PALETTES.length]!;
  const titleLines = wrapWords(title, 32, 3);
  const tspanY = Math.round(330 - (titleLines.length - 1) * 30);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <linearGradient id="plate" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFD75E"/>
      <stop offset="35%" stop-color="#FBBF24"/>
      <stop offset="70%" stop-color="#F97316"/>
      <stop offset="100%" stop-color="#F43F5E"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.2" r="0.9">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="800" height="500" fill="url(#bg)"/>
  <rect width="800" height="500" fill="url(#glow)"/>

  <!-- connectPlus emblem — signal over the savanna -->
  <g transform="translate(618 96)">
    <rect x="18" y="18" width="128" height="128" rx="34" fill="url(#plate)"/>
    <circle cx="38" cy="42" r="44" fill="#ffffff" opacity="0.12"/>
    <circle cx="104" cy="44" r="13" fill="#FFF7EA" opacity="0.95"/>
    <path d="M34 84 Q48 74 73 74 Q98 74 112 84 Q100 88 88 86.5 Q73 84.8 64 86 Q50 88 34 84 Z" fill="#FFF7EA"/>
    <path d="M69.5 86 L74.5 86 L73 110 Q72.8 112 71 112 L70 112 Q68.2 112 68.4 110 Z" fill="#FFF7EA"/>
    <rect x="68.5" y="60" width="7" height="18" rx="3.5" fill="#7C2D12"/>
    <rect x="63" y="65.5" width="18" height="7" rx="3.5" fill="#7C2D12"/>
    <path d="M118 96 l2.3 5.4 5.4 2.3 -5.4 2.3 -2.3 5.4 -2.3 -5.4 -5.4 -2.3 5.4 -2.3 Z" fill="#ffffff" opacity="0.92"/>
  </g>

  <g font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
    <rect x="48" y="44" height="40" rx="20" fill="#0a0a0d" opacity="0.55"/>
    <text x="68" y="72" font-size="18" font-weight="600" letter-spacing="1.5" fill="#ffffff" text-anchor="start">${esc(category.toUpperCase())}</text>
    <text x="48" y="${tspanY}" font-size="44" font-weight="800" letter-spacing="-0.5" fill="#ffffff" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif">
      ${titleLines.map((line, i) => `<tspan x="48" dy="${i === 0 ? 0 : 30}">${esc(line)}</tspan>`).join("")}
    </text>
    <text x="48" y="440" font-size="17" font-weight="500" fill="#ffffff" opacity="0.9">${esc(author ? `by ${author} · ` : "")}connectPlus</text>
  </g>

  <rect x="48" y="452" width="72" height="7" rx="3.5" fill="${accent}"/>
</svg>`;
}

export const THUMB_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
  "X-Content-Type-Options": "nosniff",
} as const;
