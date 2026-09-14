import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The admin console's theme contract.
 *
 * The console was written against a light-first theme, so every colour was
 * spelled as a light value plus a `dark:` override — `text-surface-900
 * dark:text-surface-50`, `bg-white dark:bg-surface-900`, and 180 more. That is
 * the one shape this app's theme cannot support: `surface-*` is a FLIPPED ramp
 * (see globals.css), so in light mode `text-surface-900` is near-white on a
 * white card and `bg-surface-100` is a near-black chip. It measured 1.1:1 —
 * literally invisible — on the console's own headings.
 *
 * These assertions are cheap string checks, and they are the only thing
 * stopping the next page from reintroducing the pattern by muscle memory.
 */

const ROOTS = ["src/app/(admin)", "src/components/admin"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(process.cwd(), dir, entry);
    if (statSync(full).isDirectory()) return walk(`${dir}/${entry}`);
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

const FILES = ROOTS.flatMap(walk).filter((file) => !file.endsWith("AdminUI.tsx"));

/** Every class-like string literal in the file. */
function classStrings(source: string): string[] {
  return [...source.matchAll(/["`]([^"`\n]*)["`]/g)]
    .map((match) => match[1] ?? "")
    .filter((body) => /(?:bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder)-/.test(body));
}

/**
 * A `dark:` colour variant is never correct here. The ramp flips on its own, so
 * a `dark:` twin means the light half is wrong.
 */
const DARK_COLOUR =
  /dark:(?:bg|text|border|ring|divide|from|via|to|fill|stroke|placeholder|decoration|caret|accent)-(?:surface|brand|red|rose|emerald|green|amber|yellow|orange|sky|cyan|blue|indigo|violet|purple|white|black)/;

/**
 * Stranded light-first steps: tokens that were never paired with a `dark:`
 * twin, so they are wrong in BOTH modes.
 *
 * Light mode: `text-surface-600` is #A7A7AB on a light card (1.6:1) and
 * `border-surface-200` is a near-black #3A3A3F hairline.
 * Dark mode: `text-surface-600` is #4C525C on #0E1114 — just as invisible.
 */
/**
 * The steps that only exist in a light-first design. 700/800/850 are NOT here:
 * on the flipped ramp those are the app's real borders, wells and cards in both
 * modes, and flagging them would make the guard meaningless noise.
 *
 * Plain `bg-white` is deliberately not flagged either: it is a FIXED colour, so
 * the one place the console wants it — the knob of a filled toggle, which must
 * stay white on a brand track in both themes — is not distinguishable from a
 * bug by looking at the class string. A stray `bg-white` card still needs a
 * human eye; a stray *pair* is caught by the `dark:` check above.
 */
const STRANDED =
  /(?:bg|border|ring|divide|from|via|to|fill|stroke|placeholder)-surface-(?:100|200|300|600)(?![-\w/])|(?:^|\s)text-surface-(?:600|700|800|900)/;

describe("the admin console's theme tokens", () => {
  it("has no legacy dark: colour overrides left anywhere in the console", () => {
    const offenders = FILES.flatMap((file) =>
      classStrings(readFileSync(file, "utf8"))
        .filter((body) => DARK_COLOUR.test(body))
        .map((body) => `${file.replace(process.cwd(), "")}: ${body.slice(0, 90)}`)
    );
    expect(offenders, "use one flipped token instead of a light/dark pair").toEqual([]);
  });

  it("has no stranded light-first steps that fail in both modes", () => {
    const offenders = FILES.flatMap((file) =>
      classStrings(readFileSync(file, "utf8"))
        .filter((body) => STRANDED.test(body))
        .map((body) => `${file.replace(process.cwd(), "")}: ${body.slice(0, 90)}`)
    );
    expect(offenders, "map the token to its flipped-ramp equivalent").toEqual([]);
  });

  it("keeps the shared primitives free of theme-specific colour", () => {
    // The primitives are the reference the rest of the console copies, so a
    // `dark:` here would propagate by example.
    const source = readFileSync(join(process.cwd(), "src/components/admin/AdminUI.tsx"), "utf8");
    expect(DARK_COLOUR.test(source)).toBe(false);
    expect(source).toContain("surface-card");
  });
});

describe("the admin shell's scroll geometry", () => {
  const shell = readFileSync(join(process.cwd(), "src/components/layout/AdminLayout.tsx"), "utf8");

  it("scrolls the document, not a nested main", () => {
    // Two nested `overflow-y-auto` boxes meant a wheel over the content could
    // move either, the header's sticky was measured against the wrong box, and
    // phones showed a doubled scroll affordance.
    expect(shell).not.toMatch(/<main[^>]*overflow-y-auto/);
    expect(shell).toMatch(/<main className="flex-1 p-/);
  });

  it("groups the navigation instead of listing sixteen flat links", () => {
    expect(shell).toContain("NAV_GROUPS");
    expect(shell).toContain('aria-label="Admin sections"');
    // Every page kept: grouping is a re-organisation, not a removal.
    for (const href of [
      "/admin",
      "/admin/analytics",
      "/admin/neural",
      "/admin/ai",
      "/admin/content",
      "/admin/moderation",
      "/admin/writers",
      "/admin/categories",
      "/admin/rss",
      "/admin/ads",
      "/admin/subscriptions",
      "/admin/payments",
      "/admin/sports",
      "/admin/users",
      "/admin/integrations",
      "/admin/settings",
    ]) {
      expect(shell, `${href} should still be reachable from the console nav`).toContain(`href: "${href}"`);
    }
  });

  it("marks the active section by longest prefix, so /admin never matches everything", () => {
    expect(shell).toContain("sort((a, b) => b.length - a.length)");
  });

  it("closes the mobile drawer on Escape and unlocks the page behind it", () => {
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('document.body.style.overflow = "hidden"');
  });
});
