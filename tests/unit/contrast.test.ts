import { describe, expect, it } from "vitest";

/**
 * WCAG AA contrast audit for the admin console + studio surfaces.
 *
 * Models the exact palette values from src/app/globals.css (surface scale,
 * flipped per theme) and tailwind.config.ts (brand + status scales), computes
 * contrast for the token pairs the UI actually uses, and fails when a pair
 * misses AA in either theme.
 *
 * Thresholds (WCAG 2.1 AA): 4.5:1 normal text, 3:1 large text / non-text UI.
 */

type RGB = readonly [number, number, number];

/** The surface scale steps as literal keys so indexed access is non-undefined. */
type SurfaceStep =
  | "50"
  | "100"
  | "200"
  | "300"
  | "400"
  | "500"
  | "600"
  | "700"
  | "800"
  | "850"
  | "900"
  | "950";

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function blend(fg: RGB, fgAlpha: number, bg: RGB): RGB {
  const a = Math.max(0, Math.min(1, fgAlpha));
  return [
    clamp255(fg[0] * a + bg[0] * (1 - a)),
    clamp255(fg[1] * a + bg[1] * (1 - a)),
    clamp255(fg[2] * a + bg[2] * (1 - a)),
  ];
}

function luminance(c: RGB): number {
  const linear = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
}

function contrast(fg: RGB, bg: RGB): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------ */
/* Theme tokens — mirror globals.css + tailwind.config.ts.             */
/* ------------------------------------------------------------------ */

const surfaceDark: Record<SurfaceStep, RGB> = {
  "50": [252, 252, 253],
  "100": [246, 246, 248],
  "200": [232, 232, 236],
  "300": [219, 219, 224],
  "400": [174, 174, 184],
  "500": [124, 124, 134],
  "600": [90, 90, 100],
  "700": [68, 68, 76],
  "800": [42, 42, 46],
  "850": [32, 32, 36],
  "900": [26, 26, 30],
  "950": [10, 10, 13],
};

const surfaceLight: Record<SurfaceStep, RGB> = {
  "50": [26, 32, 44], // #1A202C deep charcoal
  "100": [45, 55, 72], // #2D3748
  "200": [51, 65, 85], // #334155
  "300": [63, 76, 96], // #3F4C60
  "400": [71, 85, 105], // #475569
  "500": [100, 116, 139], // #64748B muted blue-grey
  "600": [148, 163, 184], // #94A3B8 icons/placeholders
  "700": [203, 213, 225], // #CBD5E1 borders
  "800": [226, 232, 240], // #E2E8F0 inputs/hairlines
  "850": [233, 237, 242], // #E9EDF2 elevated
  "900": [240, 243, 247], // #F0F3F7 cards
  "950": [244, 246, 248], // #F4F6F8 canvas
};

const WHITE: RGB = [255, 255, 255];

const brand = {
  "300": [255, 178, 115],
  "400": [255, 143, 58],
  "500": [255, 107, 0],
  "600": [224, 95, 0],
  "700": [184, 78, 0],
  "800": [143, 61, 0],
} as const;

const amber = {
  "300": [252, 211, 77],
  "400": [251, 191, 36],
  "500": [245, 158, 11],
  "600": [217, 119, 6],
  "700": [180, 83, 9],
  "800": [146, 64, 14],
} as const;

const emerald = {
  "300": [110, 231, 183],
  "400": [52, 211, 153],
  "500": [16, 185, 129],
  "600": [5, 150, 105],
  "700": [4, 120, 87],
  "800": [6, 95, 70],
} as const;

const cyan = {
  "300": [103, 232, 249],
  "400": [34, 211, 238],
  "500": [6, 182, 212],
  "600": [8, 145, 178],
  "700": [14, 116, 144],
  "800": [21, 94, 117],
} as const;

const red = {
  "300": [252, 165, 165],
  "400": [248, 113, 113],
  "500": [239, 68, 68],
  "600": [220, 38, 38],
  "700": [185, 28, 28],
  "800": [153, 27, 27],
} as const;

/* ------------------------------------------------------------------ */
/* Pair builder                                                        */
/* ------------------------------------------------------------------ */

interface Pair {
  name: string;
  fg: RGB;
  bg: RGB;
  /** true => large-text/UI threshold (3:1), false => normal text (4.5:1) */
  ui?: boolean;
}

/** Resolve a token RGB for the active theme (dark = base). */
function resolveSurface(c: RGB, S: Record<SurfaceStep, RGB>): RGB {
  for (const [step, value] of Object.entries(surfaceDark)) {
    if (value[0] === c[0] && value[1] === c[1] && value[2] === c[2]) {
      const resolved = S[step as SurfaceStep];
      if (resolved) return resolved;
    }
  }
  return c;
}

function pairsForTheme(theme: "light" | "dark"): Pair[] {
  const S: Record<SurfaceStep, RGB> = theme === "light" ? surfaceLight : surfaceDark;
  const tint = (color: RGB, alpha: number, bg: RGB) => blend(color, alpha, bg);

  return [
    /* --- Page / card chrome -------------------------------------- */
    { name: "page: heading on canvas", fg: S["50"], bg: S["950"] },
    { name: "card: body on card", fg: S["200"], bg: S["900"] },
    { name: "card: title on card", fg: S["50"], bg: S["900"] },
    { name: "control: label on control", fg: S["100"], bg: S["800"] },
    { name: "control: disabled on control", fg: S["400"], bg: S["800"] },
    { name: "input: value on input", fg: S["50"], bg: S["900"] },
    { name: "input: placeholder on input", fg: S["500"], bg: S["900"], ui: true },
    { name: "nav: active tab on tab rail", fg: S["50"], bg: S["800"] },
    { name: "nav: idle tab on tab rail", fg: S["400"], bg: S["850"] },
    { name: "panel: secondary on card", fg: S["300"], bg: S["900"] },
    { name: "panel: faint meta on card", fg: S["400"], bg: S["900"] },
    { name: "table: header on table", fg: S["400"], bg: S["900"] },
    { name: "button: ghost on control", fg: S["300"], bg: S["800"] },
    { name: "avatar: letter on avatar", fg: S["200"], bg: S["700"] },

    /* --- Chat surfaces -------------------------------------------- */
    { name: "chat: assistant bubble text", fg: S["50"], bg: S["800"] },
    { name: "chat: user bubble text on brand tint", fg: S["50"], bg: tint(brand["500"], 0.2, S["950"]) },
    { name: "chat: intent badge on bubble", fg: S["300"], bg: S["700"] },
    { name: "chat: quick chip on panel", fg: S["300"], bg: S["900"] },

    /* --- Status badges & tinted chips (semantic, both themes) ----- */
    { name: "badge: brand on brand 15% tint", fg: theme === "light" ? brand["800"] : brand["300"], bg: tint(brand["500"], 0.15, S["900"]) },
    { name: "badge: amber on amber 15% tint", fg: theme === "light" ? amber["800"] : amber["300"], bg: tint(amber["500"], 0.15, S["900"]) },
    { name: "badge: emerald on emerald 15% tint", fg: theme === "light" ? emerald["800"] : emerald["300"], bg: tint(emerald["500"], 0.15, S["900"]) },
    { name: "badge: cyan on cyan 15% tint", fg: theme === "light" ? cyan["800"] : cyan["300"], bg: tint(cyan["500"], 0.15, S["900"]) },
    { name: "badge: red on red 15% tint", fg: theme === "light" ? red["800"] : red["300"], bg: tint(red["500"], 0.15, S["900"]) },

    /* --- Studio composer (editor surface is white in BOTH themes) -- */
    { name: "studio: body text on editor", fg: theme === "light" ? surfaceLight["50"] : surfaceDark["950"], bg: WHITE },
    { name: "studio: title on editor", fg: theme === "light" ? surfaceLight["50"] : surfaceDark["950"], bg: WHITE },
    { name: "studio: excerpt on editor", fg: theme === "light" ? surfaceLight["50"] : surfaceDark["950"], bg: WHITE },
    { name: "studio: placeholder on editor", fg: theme === "light" ? surfaceLight["500"] : surfaceDark["500"], bg: WHITE, ui: true },
    { name: "studio: section label", fg: S["300"], bg: S["900"] },
    { name: "studio: brand tag on tint", fg: theme === "light" ? brand["800"] : brand["300"], bg: tint(brand["500"], 0.15, S["900"]) },
    { name: "studio: brand chip on rail", fg: theme === "light" ? brand["800"] : brand["300"], bg: tint(brand["500"], 0.15, S["850"]) },
    { name: "studio: rail label on panel", fg: S["200"], bg: S["900"] },
    { name: "studio: rail faint on panel", fg: S["400"], bg: S["900"] },
  ];
}

/* ------------------------------------------------------------------ */

describe("WCAG AA contrast — admin console + studio", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`passes AA in ${theme} mode`, () => {
      const failures: { name: string; ratio: number; threshold: number }[] = [];

      for (const pair of pairsForTheme(theme)) {
        const fg = resolveSurface(pair.fg, theme === "light" ? surfaceLight : surfaceDark);
        const bg = resolveSurface(pair.bg, theme === "light" ? surfaceLight : surfaceDark);
        const ratio = contrast(fg, bg);
        const threshold = pair.ui ? 3 : 4.5;
        if (ratio < threshold) {
          failures.push({ name: pair.name, ratio, threshold });
        }
      }

      const lines = failures.map((f) => `  ✗ ${f.name}: ${f.ratio.toFixed(2)}:1 (needs ${f.threshold}:1)`);
      expect(failures, `[${theme} mode] AA contrast failures:\n${lines.join("\n")}`).toEqual([]);
    });
  }
});