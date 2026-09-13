import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Light-mode depth contract.
 *
 * The light theme is a warm "savanna paper" canvas with near-white surfaces.
 * That only reads as depth if the canvas is measurably darker than the panels
 * sitting on it — otherwise every card dissolves into the page and the whole UI
 * looks like one flat white sheet (the bug this guards).
 *
 * Instead of eyeballing it, this reads the real token block out of globals.css
 * and asserts the luminance ladder, so a future palette tweak that flattens the
 * canvas fails the build instead of shipping.
 */

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

type Rgb = [number, number, number];
type TokenMap = Record<string, Rgb>;

/** Pull the `--token: r g b;` declarations out of a block. */
function block(selectorPattern: RegExp): TokenMap {
  const match = selectorPattern.exec(css);
  const body = match?.[1];
  if (body === undefined) throw new Error(`no CSS block matched ${selectorPattern}`);

  const out: TokenMap = {};
  const re = /--([a-z0-9-]+):\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    // The regex has four capture groups, so these are always present.
    out[String(m[1])] = [Number(m[2]!), Number(m[3]!), Number(m[4]!)];
  }
  return out;
}

function token(theme: TokenMap, name: string): Rgb {
  const value = theme[name];
  if (!value) throw new Error(`missing token --${name}`);
  return value;
}

const sum = (rgb: Rgb) => rgb[0] + rgb[1] + rgb[2];

const dark = block(/:root \{([^}]*)\}/);
const light = block(/html:not\(\.dark\) \{([^}]*)\}/);

describe("theme depth tokens", () => {
  it("defines an elevation ramp in both themes", () => {
    expect(css.match(/--elev-1:/g) ?? []).toHaveLength(2);
    expect(css.match(/--elev-2:/g) ?? []).toHaveLength(2);
    expect(css.match(/--elev-3:/g) ?? []).toHaveLength(2);
    expect(css).toContain("--hairline-top:");
    // Both themes must actually resolve the surfaces the ramp sits on.
    for (const theme of [dark, light]) {
      expect(sum(token(theme, "surface-950"))).toBeGreaterThan(0);
      expect(sum(token(theme, "surface-850"))).toBeGreaterThan(0);
    }
  });

  it("stacks the light palette canvas → panel → card, lightest on top", () => {
    const canvas = sum(token(light, "surface-950"));
    const panel = sum(token(light, "surface-900"));
    const card = sum(token(light, "surface-850"));

    expect(canvas).toBeLessThan(panel);
    expect(panel).toBeLessThan(card);
    // The original bug: a 4-level gap between canvas and panel is invisible.
    expect(panel - canvas).toBeGreaterThanOrEqual(25);
    expect(card - canvas).toBeGreaterThanOrEqual(40);
  });

  it("keeps the light canvas a neutral grey, never pure white", () => {
    const canvas = token(light, "surface-950");

    /**
     * This assertion is the inverse of what it used to be.
     *
     * The canvas was previously a warm "savanna paper" and the test pinned the
     * red channel above the blue one. The light theme is now a deliberately
     * NEUTRAL grey (#D3D3D3) so photography, team badges and brand orange read
     * true instead of picking up a wash from the page behind them. Pinning
     * "warm" here would now fail on a correct palette, so it pins *neutrality*
     * instead — which is the property worth protecting in the other direction:
     * a stray tint is exactly how the old palette would creep back in.
     */
    const spread = Math.max(...canvas) - Math.min(...canvas);
    expect(spread).toBeLessThanOrEqual(2);
    // ...and still clearly greyer than white, or every card loses its edge.
    expect(canvas[0]).toBeLessThan(230);
  });

  it("separates a light card from its border", () => {
    expect(sum(token(light, "card-bg"))).toBeGreaterThan(sum(token(light, "card-border")));
  });

  it("gives bordered surfaces a global lift instead of relying on markup edits", () => {
    expect(css).toContain('html:not(.dark) [class*="border-surface-"]');
    // ...and reinforces the canvas with a faint wash so cards read as raised.
    expect(css).toMatch(/html:not\(\.dark\) body \{[\s\S]*?background-image:/);
  });

  it("exposes semantic surface helpers for new UI", () => {
    for (const cls of [".surface-card", ".surface-raised", ".surface-sunken"]) {
      expect(css).toContain(cls);
    }
  });
});
