import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Feed card visibility and hydration.
 *
 * Both rules asserted here exist because of the same report: the home feed's
 * covers loaded and were then not seen. Neither bug was in the image — the file
 * was fetched, `naturalWidth` was set, and the card was blank — and neither was
 * visible in a single component's code. They only appeared when a *re-render*
 * met imperative class bookkeeping:
 *
 *  1. `AnimatedCard` shipped `opacity-0` and an inline observer added
 *     `is-visible` on scroll. React owns `className`, so the first re-render put
 *     `opacity-0` back on cards already on screen; the observer had unobserved
 *     them and its MutationObserver watched `childList` only, so an attribute
 *     change was invisible to it. The card stayed blank.
 *
 *  2. The relative timestamps in the same tree are computed from `Date.now()` on
 *     both sides, and the page is cached (`revalidate = 60`), so server and
 *     client legitimately disagree. React answers a mismatch by regenerating the
 *     tree — which is the re-render that triggered (1), and which throws away DOM
 *     the reader had already painted.
 *
 * These are source-level assertions on purpose. The regression is a *structure*
 * ("content visibility depends on something that does not survive a re-render"),
 * and no render of a single component can detect it.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * The same source with comments removed.
 *
 * These files explain the bugs they were fixed for, so they *name* the classes
 * and selectors being guarded against. Asserting on the raw source would fail on
 * the explanation — and, worse, would pass for anyone who deleted the comment,
 * which is the opposite of a guard.
 */
function code(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FEED_CARDS = "src/components/feed/FeedCards.tsx";
const HOME_PAGE = "src/app/(public)/page.tsx";
const GLOBALS = "src/app/globals.css";

describe("feed card visibility", () => {
  it("does not put a hidden resting state in the card's markup", () => {
    const source = code(FEED_CARDS);
    const card = source.slice(source.indexOf("export function AnimatedCard"));
    const body = card.slice(0, card.indexOf("\n}\n"));

    // `opacity-0` is the thing that made a card's visibility something React
    // could take away by re-rendering the className it owns.
    expect(body).not.toContain("opacity-0");
    expect(body).toContain("stagger-card");
  });

  it("does not depend on a script to reveal cards", () => {
    // The observer only ever existed to undo the class above. Leaving it behind
    // would mean two mechanisms claiming the same job, one of which silently
    // stops happening after the first re-render.
    expect(code(HOME_PAGE)).not.toContain("stagger-observer");
    expect(code(FEED_CARDS)).not.toContain("is-visible");
    expect(code(GLOBALS)).not.toContain(".stagger-card.is-visible");
  });

  it("animates the card in from a visible default", () => {
    const css = code(GLOBALS);
    const rule = css.slice(css.indexOf(".stagger-card {"), css.indexOf(".stagger-card {") + 200);
    // `animation` (not `transition`) is what makes the resting state visible:
    // the keyframes play the card in, and if they never run the element simply
    // sits at opacity 1. A transition from `opacity-0` has no such floor.
    expect(rule).toContain("animation:");
    expect(css).toContain("@keyframes stagger-card-in");
  });

  it("keeps cards visible when motion is reduced", () => {
    const css = code(GLOBALS);
    const reduced = css.slice(css.indexOf("prefers-reduced-motion: reduce"));
    // A reduced-motion reader must not be the one person for whom the entrance
    // animation is skipped and the content goes with it.
    expect(reduced).toContain(".stagger-card");
  });
});

describe("relative time in a cached feed", () => {
  const surfaces = [FEED_CARDS, "src/components/feed/HeroSlideshow.tsx"];

  it("lets the timestamp differ instead of replacing the reader's DOM", () => {
    for (const file of surfaces) {
      const source = code(file);
      let from = 0;
      let found = 0;
      for (;;) {
        const at = source.indexOf("timeAgo(", from);
        if (at === -1) break;
        found++;
        const window = source.slice(Math.max(0, at - 400), at);
        expect(
          window,
          `${file}: the timeAgo() at offset ${at} needs suppressHydrationWarning on the element carrying it`
        ).toContain("suppressHydrationWarning");
        from = at + 1;
      }
      expect(found, `${file} should render a relative timestamp`).toBeGreaterThan(0);
    }
  });
});
