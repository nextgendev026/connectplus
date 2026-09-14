import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The theme-aware accent ramp.
 *
 * `brand-*` is the most-used colour family in the app, so it is the one most
 * easily broken by a well-meaning edit. It was broken once already: the palette
 * was literal hex in tailwind.config.ts, which made every `bg-brand-500` and
 * `text-brand-400` paint the same brightened dark-mode orange on paper. The
 * `--brand-primary` tokens in globals.css had a light-mode value all along, but
 * almost nothing reads them, so light mode looked washed out while the CSS
 * claimed otherwise.
 *
 * These assertions are structural rather than visual: they pin the *wiring*
 * (variables, not hex, declared in both themes) which is the part a reviewer
 * cannot see in a diff of a Tailwind config.
 */

const root = resolve(__dirname, "../..");
const tailwind = readFileSync(resolve(root, "tailwind.config.ts"), "utf8");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");

/** The declaration block for one selector, by brace matching. */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `selector ${selector} not found`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

describe("brand accent ramp", () => {
  it("is driven by CSS variables so a theme can change it", () => {
    // Hex here is the exact bug: it makes the palette theme-blind. Comments are
    // stripped first — the block explains this history and names the old hex.
    const palette = tailwind.replace(/\/\/[^\n]*/g, "");
    expect(palette).not.toMatch(/brand:\s*\{[^}]*#[0-9a-fA-F]{3,8}/);
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      expect(tailwind).toContain(`${step}: "rgb(var(--brand-${step}) / <alpha-value>)",`);
    }
  });

  it("defines every step in both themes", () => {
    const dark = block(css, ":root");
    const light = block(css, "html:not(.dark)");
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
      expect(dark, `dark is missing --brand-${step}`).toMatch(
        new RegExp(`--brand-${step}:\\s*\\d+ \\d+ \\d+;`)
      );
      expect(light, `light is missing --brand-${step}`).toMatch(
        new RegExp(`--brand-${step}:\\s*\\d+ \\d+ \\d+;`)
      );
    }
  });

  it("makes the light accent materially darker than the dark one", () => {
    // Perceived brightness of the 500 step, on the standard 299/587/114 weights.
    const brightness = (triplet: string) => {
      const parts = triplet.split(/\s+/).map(Number);
      const [r = 0, g = 0, b = 0] = parts;
      return (r * 299 + g * 587 + b * 114) / 1000;
    };
    const read = (source: string, selector: string) => {
      const value = block(source, selector).match(/--brand-500:\s*([\d\s]+);/)?.[1];
      expect(value, `--brand-500 missing in ${selector}`).toBeTruthy();
      return brightness((value ?? "").trim());
    };
    const dark = read(css, ":root");
    const light = read(css, "html:not(.dark)");
    // A deepening, not a nudge — the light accent must not be the night one.
    expect(light).toBeLessThan(dark - 30);
  });

  it("keeps the primary tokens agreeing with the ramp they duplicate", () => {
    // 400/500/600 mirror --brand-primary-light/primary/dark. If they drift, the
    // handful of places using the token stop matching the utilities.
    const hex = (source: string, selector: string, prop: string) =>
      (block(source, selector)
        .match(new RegExp(`--${prop}:\\s*#([0-9a-f]{6});`))?.[1]
        ?.match(/../g) ?? []
      )
        .map((pair) => parseInt(pair, 16))
        .join(" ");
    const triplet = (selector: string, step: number) =>
      block(css, selector)
        .match(new RegExp(`--brand-${step}:\\s*([\\d\\s]+);`))?.[1]
        ?.trim();

    expect(hex(css, ":root", "brand-primary")).toBe(triplet(":root", 500));
    expect(hex(css, ":root", "brand-primary-light")).toBe(triplet(":root", 400));
    expect(hex(css, ":root", "brand-primary-dark")).toBe(triplet(":root", 600));
    expect(hex(css, "html:not(.dark)", "brand-primary")).toBe(triplet("html:not(.dark)", 500));
    expect(hex(css, "html:not(.dark)", "brand-primary-light")).toBe(triplet("html:not(.dark)", 400));
    expect(hex(css, "html:not(.dark)", "brand-primary-dark")).toBe(triplet("html:not(.dark)", 600));
  });

  it("themes the focus ring too", () => {
    // A hardcoded ring is the same class of bug: dark-mode orange on paper.
    const ring = css.slice(css.indexOf("*:focus-visible"));
    expect(ring.slice(0, 200)).toContain("var(--brand-primary)");
  });
});
