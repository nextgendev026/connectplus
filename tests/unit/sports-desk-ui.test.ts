import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The sports desk's presentation rules, pinned where they are easy to undo by
 * accident.
 *
 * Three of these were real defects rather than taste:
 *
 *   • The bright accent steps (`text-emerald-400`, `text-amber-300`, …) are drawn
 *     for a night background and were the last thing on the page failing WCAG AA
 *     on the light canvas — a green "win" beside an orange "pick" measured 2.3:1
 *     while the orange measured 6.2:1.
 *
 *   • The desk was written at 9–11px. On a phone in daylight that is decoration,
 *     not text.
 *
 *   • The toolbar pinned itself at `top-0`, which is *underneath* the app navbar
 *     (z-50, 4rem tall): the day strip could not be seen or tapped for the whole
 *     page, and the filter row was not sticky at all.
 *
 * These are CSS and className assertions, so they are cheap — and they are the
 * only thing standing between these fixes and a future refactor quietly putting
 * the toolbar back behind the navbar.
 */

const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

/** Pull one `selector { … }` block out of the stylesheet. */
function block(selector: string): string {
  const at = css.indexOf(selector);
  expect(at, `expected globals.css to define ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("light-mode accent ink", () => {
  it("darkens every bright accent family that was failing on paper", () => {
    // Amber is the one that was worst: amber-300 measured 1.7:1 on a light card.
    const amber = css.match(/html:not\(\.dark\) :is\(([\s\S]*?)\) \{ color: #92400e; \}/);
    expect(amber, "amber accents should be re-inked in light mode").not.toBeNull();
    expect(amber![1]).toContain(".text-amber-300");
    expect(amber![1]).toContain(".text-amber-400");

    const positive = css.match(/html:not\(\.dark\) :is\(([\s\S]*?)\) \{ color: #047857; \}/);
    expect(positive, "green accents should be re-inked in light mode").not.toBeNull();
    expect(positive![1]).toContain(".text-emerald-400");

    const danger = css.match(/html:not\(\.dark\) :is\(([\s\S]*?)\) \{ color: #991b1b; \}/);
    expect(danger, "red accents should be re-inked in light mode").not.toBeNull();
    expect(danger![1]).toContain(".text-red-400");
  });

  it("uses unlayered rules, so Tailwind's utilities cannot outrank them", () => {
    // A rule inside `@layer components` loses to `@layer utilities` no matter how
    // specific it is; unlayered CSS wins over both. This block has to stay
    // unlayered or the fix silently stops applying.
    const overrides = css.slice(css.indexOf("ACCENT INK ON PAPER"));
    const firstSelector = overrides.indexOf("html:not(.dark) :is(");
    const lastLayer = overrides.lastIndexOf("@layer");
    expect(firstSelector).toBeGreaterThan(-1);
    expect(lastLayer).toBeLessThan(firstSelector);
  });

  it("keeps an opt-out for surfaces that are dark in both themes", () => {
    // A photo overlay or a black gradient still needs the bright step.
    expect(css).toContain("html:not(.dark) .on-ink :is(");
  });
});

describe("sports desk type scale", () => {
  /**
   * The desk's type is one multiplier, which makes this the only place that can
   * defend it. Two things need defending. The desk was deliberately sized *up*
   * from 9–11px copy, so a future "reduce it again" must not walk it back to
   * decoration — hence the floor. And the scale is adjusted by editing a single
   * number, so nothing else in the codebase would notice it drifting away from
   * what the stylesheet's own prose claims it is.
   */
  const OPENING_MULTIPLIER = 1.25;
  /**
   * The current value: the opening multiplier less the requested 5%, then less a
   * further 10% on the sports page for desktop density.
   *
   * 1.25 × 0.95 × 0.90 = 1.06875
   */
  const MULTIPLIER = 1.06875;
  /**
   * The smallest step a reader actually has to read — `text-[10px]`, scaled.
   *
   * The floor was 11.8px at the 5%-reduction point (10 × 1.1875). The sports
   * page has since been asked to come down another 10% for desktop density, which
   * lands the 10px step at 10.6875px — still above the original undecorated 10px
   * the desk was written at, so it is not back to decoration. The floor follows
   * the reduction rather than blocking it, because the decision has been made
   * upstream (the request that produced this test failure).
   */
  const LEGIBILITY_FLOOR_PX = 10.5;

  /** Read the live multiplier out of the stylesheet, not out of the test. */
  function declaredMultiplier(): number {
    const m = block(".sports-desk {").match(/--sports-type:\s*([\d.]+)/);
    expect(m, "--sports-type should be declared with a numeric value").not.toBeNull();
    return Number(m![1]);
  }

  it("scales every size the desk uses by the documented multiplier", () => {
    expect(block(".sports-desk {")).toContain(`--sports-type: ${MULTIPLIER}`);
    // Every step the desk writes gets a rule that derives from the variable, so
    // a size added later is scaled by adding a rule rather than by hard-coding.
    for (const size of ["6px", "8px", "9px", "10px", "11px", "13px"]) {
      expect(css).toContain(`.sports-desk .text-\\[${size}\\]`);
    }
    for (const use of ["text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl", "text-4xl"]) {
      expect(css).toMatch(
        new RegExp(`\\.sports-desk \\.${use}\\s*\\{ font-size: calc\\([^)]*var\\(--sports-type\\)\\)`)
      );
    }
    // 13 declared steps, all of them through the multiplier and none beside it.
    expect((css.match(/var\(--sports-type\)/g) ?? []).length).toBe(13);
  });

  it("is the opening multiplier less the 5% reduction and the further 10% sports reduction", () => {
    // 1.25 × 0.95 × 0.90 = 1.06875
    expect(declaredMultiplier()).toBeCloseTo(OPENING_MULTIPLIER * 0.95 * 0.90, 5);
    expect(declaredMultiplier()).toBe(MULTIPLIER);
    // The stylesheet has to keep explaining where the number came from, or the
    // next reader cannot tell a 5% reduction from a typo.
    expect(css).toContain("1.25 × 0.95");
    expect(css).not.toContain("--sports-type: 1.25");
  });

  it("keeps the smallest copy above the legibility floor", () => {
    // This is the assertion that makes the next reduction a decision: the floor
    // is the size the desk was fixed to for being unreadable on a phone.
    expect(10 * declaredMultiplier()).toBeGreaterThanOrEqual(LEGIBILITY_FLOOR_PX);
  });

  it("moves every weight up one step", () => {
    expect(css).toMatch(/\.sports-desk \.font-medium\s*\{ font-weight: 600; \}/);
    expect(css).toMatch(/\.sports-desk \.font-semibold\s*\{ font-weight: 700; \}/);
    expect(css).toMatch(/\.sports-desk \.font-bold\s*\{ font-weight: 800; \}/);
  });

  it("is applied by the desk's root element", () => {
    expect(read("src/components/sports/SportsHub.tsx")).toContain('className="sports-desk ');
  });
});

describe("sports desk chrome", () => {
  const surfaces = [
    "src/components/sports/ScoresBoard.tsx",
    "src/components/sports/MatchCalendar.tsx",
    "src/components/sports/BettingTips.tsx",
    "src/components/sports/MatchCentre.tsx",
  ];

  it.each(surfaces)("%s parks its toolbar below the navbar, not behind it", (file) => {
    const source = read(file);
    expect(source).toContain("sports-toolbar sticky");
    // The navbar is 4rem tall and z-50; `top-0` puts the toolbar underneath it.
    expect(source).not.toMatch(/className="sticky top-0 /);
    // The offset is owned by globals.css so the switcher and the toolbar cannot
    // be told the same `top` and land on the same pixel.
    expect(source).not.toMatch(/sports-toolbar sticky[^"]*top-/);
  });

  it("stacks the board switcher above the toolbar, not on top of it", () => {
    const nav = block(".sports-nav {");
    expect(nav).toContain("top: 4rem");
    // The toolbar's offset is the switcher's own height, which the desk measures
    // at runtime; a hand-written number was wrong at both breakpoints because
    // the desk's type scale makes the bar taller than its classes suggest.
    expect(block(".sports-toolbar {")).toMatch(/top: calc\(4rem \+ var\(--sports-nav-h/);
    expect(css).toMatch(/--sports-nav-h: [\d.]+rem/);
  });

  it("publishes the switcher's measured height rather than guessing it", () => {
    const hub = read("src/components/sports/SportsHub.tsx");
    expect(hub).toContain("ResizeObserver");
    expect(hub).toContain('setProperty("--sports-nav-h"');
  });

  it("puts the board switcher directly below the hero on every screen", () => {
    const hub = read("src/components/sports/SportsHub.tsx");
    expect(hub).toContain('className="sports-nav');
    expect(hub).toContain('aria-label="Sports boards"');
    // One switcher, not one at the top and another pinned over the bottom of
    // every board on a phone.
    expect(hub.match(/aria-label="Sports boards"/g)).toHaveLength(1);
    expect(hub).not.toContain("fixed inset-x-0 bottom-0");
  });

  it("is a sibling of the hero, not a child of it", () => {
    // THE regression. The switcher used to sit inside the hero <section>, which
    // is `overflow-hidden` to clip its glows — and an `overflow-hidden` ancestor
    // is the switcher's scroll container, so `position: sticky` could never pin
    // it to the viewport. It scrolled away with the hero, which is exactly why
    // the menu looked like it was in the wrong place.
    const hub = read("src/components/sports/SportsHub.tsx");
    const heroCloses = hub.indexOf("</section>");
    const switcher = hub.indexOf('className="sports-nav');
    expect(heroCloses).toBeGreaterThan(-1);
    expect(switcher).toBeGreaterThan(heroCloses);
  });

  it("keeps the switcher short enough on a phone not to eat the board", () => {
    const hub = read("src/components/sports/SportsHub.tsx");
    // The one-word hint is what made the mobile bar ~90px tall; it is a `sm:`
    // affordance now and the phone gets icon + label only.
    expect(hub).toMatch(/hidden truncate text-\[10px\][^"]*sm:block/);
  });
});

describe("horizontal chrome stays contained", () => {
  /**
   * `shrink-0` children in a nowrap flex row with no scroll container cannot
   * shrink and cannot wrap, so the overflow escapes every ancestor and the whole
   * document becomes sideways-scrollable. That is not a local cosmetic bug: one
   * such row in the tips toolbar made the 320px viewport render a 799px page,
   * which on a phone lets any vertical swipe with a few degrees of drift drag
   * the page out of alignment.
   */
  it("gives the tips market chips a rail instead of a shove", () => {
    const tips = read("src/components/sports/BettingTips.tsx");
    expect(tips).toMatch(/scrollbar-hide[^"]*overflow-x-auto|overflow-x-auto[^"]*scrollbar-hide/);
  });

  it("gives every day in the mobile week rail its own width", () => {
    const calendar = read("src/components/sports/MatchCalendar.tsx");
    // Seven `flex-1` cells split what is left after the week buttons — about
    // 34px each on a 320px phone, which a 12.5px weekday and a 17.5px date do
    // not fit into. A fixed basis plus a scroller is the de-squeeze.
    expect(calendar).toContain("snap-x");
    expect(calendar).toMatch(/shrink-0 basis-\[2\.5rem\] snap-start/);
    // The rail also has to keep the selected day in view. `scrollLeft` is set
    // directly: `scrollIntoView` may scroll the page as well as the rail.
    expect(calendar).toContain("weekRail.current");
    expect(calendar).not.toMatch(/\.scrollIntoView\(/);
  });

  it("lets the fixture toolbar wrap rather than push the page sideways", () => {
    const calendar = read("src/components/sports/MatchCalendar.tsx");
    // Month stepper + Today + Refresh is ~384px of content; on a 320px screen a
    // nowrap row of it overflowed by 49px.
    expect(calendar).toContain("flex flex-wrap items-center gap-x-2 gap-y-1.5");
  });
});

describe("tip cards", () => {
  const source = read("src/components/sports/BettingTips.tsx");

  it("keeps every card in a row the same height", () => {
    expect(source).toContain("auto-rows-fr");
    expect(source).toContain("flex h-full flex-col");
  });

  it("puts the sponsored placement outside the card grid", () => {
    // As a grid cell it cut the board in half and left the cards either side of
    // it stranded at different heights.
    const grid = source.slice(source.indexOf("auto-rows-fr"), source.indexOf("inlineAd &&"));
    expect(grid).not.toContain("inlineAd");
  });

  it("hides the fourth reason and the audit trail behind one disclosure", () => {
    expect(source).toContain("limit={3}");
    expect(source).toContain("The full working");
  });
});
