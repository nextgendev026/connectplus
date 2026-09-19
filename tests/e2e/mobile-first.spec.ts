import { test, expect, type Page } from "@playwright/test";

/**
 * Mobile-first: no page may scroll sideways, and every page must be usable.
 *
 * The sports desk already has a spec of its own for the overflow bug that
 * started this (`shrink-0` in a nowrap row measuring 799px on a 390px screen).
 * This one generalises the assertion to the rest of the public build, because
 * that defect was not special to sports — it was one instance of a class, and
 * the class is what a phone notices first. A page that scrolls sideways cannot
 * be scrolled back reliably: any vertical swipe with a few degrees of drift
 * drags it out of alignment.
 *
 * Two checks per page, because they fail differently:
 *
 *   • **Overflow** — `scrollWidth > clientWidth` on the document. Catches an
 *     element that escaped its container.
 *   • **Tap targets** — nothing below 24px in either direction. A link that is
 *     14px tall is a link a thumb misses, which on a phone reads as "the app is
 *     broken" rather than "that button is small".
 *
 * The widths are the ones that actually hurt: 320px is the narrowest phone still
 * in use, 390px is the common one, 768px is the tablet breakpoint where layouts
 * usually flip and stop being tested.
 */

test.setTimeout(120_000);

const WIDTHS = [
  { width: 320, height: 720, label: "small phone" },
  { width: 390, height: 844, label: "phone" },
  { width: 768, height: 1024, label: "tablet" },
];

/** Public pages, in the order a reader meets them. */
const PAGES = [
  { path: "/", name: "feed" },
  { path: "/trending", name: "trending" },
  { path: "/categories", name: "categories" },
  { path: "/sports", name: "sports" },
  { path: "/radio", name: "radio" },
  { path: "/pricing", name: "pricing" },
  { path: "/search?q=nairobi", name: "search" },
  { path: "/about", name: "about" },
  { path: "/help", name: "help" },
  { path: "/auth/signin", name: "sign in" },
  { path: "/auth/signup", name: "sign up" },
];

async function settle(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  // Client-side content (fixtures, picks, the feed) lands after paint, and it is
  // the part that overflows. Giving it a beat is what makes the measurement
  // stable rather than a coin flip.
  await page
    .waitForFunction(() => !/(Loading|Getting today)/i.test(document.body.innerText), { timeout: 20_000 })
    .catch(() => {});
  await page.waitForTimeout(250);
}

async function overflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    // The widest offender, so a failure names the element instead of the page.
    let worst: { tag: string; width: number; cls: string } | null = null;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width <= doc.clientWidth || rect.height === 0) continue;
      const right = rect.right + window.scrollX;
      if (right <= doc.clientWidth + 1) continue;
      if (!worst || rect.width > worst.width) {
        worst = { tag: el.tagName.toLowerCase(), width: Math.round(rect.width), cls: el.className?.toString().slice(0, 120) ?? "" };
      }
    }
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, worst };
  });
}

/** Interactive elements that are too small to hit reliably with a thumb. */
async function undersizedTargets(page: Page) {
  return page.evaluate(() => {
    const MIN = 24;
    const out: { text: string; w: number; h: number }[] = [];
    const nodes = document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [role='button'], input[type='checkbox']");
    for (const el of nodes) {
      // A checkbox inside a <label> is tapped through the *label* — that is the
      // element with the padding and the hit area. Measuring the 14px box
      // instead reported a defect on every page that has a setting on it, which
      // is how an audit earns a reputation for noise and stops being read.
      const target = enclosingLabel(el) ?? el;

      // A link inside a sentence is exempt, and deliberately so: WCAG's 24px
      // minimum carves out targets "in a sentence or block of text", because
      // padding them out would break the line height of the prose they sit in.
      // The measurable form of that is `display: inline` — a link styled as a
      // control (`inline-flex`, `block`, a flex child) is *not* exempt, and is
      // the kind this audit is for.
      if (target.tagName === "A" && getComputedStyle(target).display === "inline") continue;

      const rect = target.getBoundingClientRect();
      // Off-screen or hidden elements cannot be tapped, so they are not defects.
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.bottom < 0 || rect.top > document.documentElement.scrollHeight) continue;
      if (getComputedStyle(target).visibility === "hidden") continue;
      if (rect.height >= MIN && rect.width >= MIN) continue;
      out.push({
        text: (target.innerText || target.getAttribute("aria-label") || target.tagName).trim().slice(0, 40),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      });
    }
    return out;

    function enclosingLabel(el: HTMLElement): HTMLElement | null {
      if (el.tagName !== "INPUT") return null;
      const label = el.closest("label");
      return label instanceof HTMLElement ? label : null;
    }
  });
}

for (const size of WIDTHS) {
  test.describe(`at ${size.width}px (${size.label})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const target of PAGES) {
      test(`${target.name} does not scroll sideways`, async ({ page }) => {
        await page.goto(target.path);
        await settle(page);

        const { scrollWidth, clientWidth, worst } = await overflow(page);
        const detail = worst
          ? `widest offender: <${worst.tag} class="${worst.cls}"> at ${worst.width}px`
          : "no single element identified";
        expect(
          scrollWidth,
          `${target.name} widens the document to ${scrollWidth}px on a ${clientWidth}px screen — ${detail}`
        ).toBeLessThanOrEqual(clientWidth + 1);
      });
    }
  });
}

test.describe("tap targets on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const target of PAGES) {
    test(`${target.name} has nothing smaller than 24px`, async ({ page }) => {
      await page.goto(target.path);
      await settle(page);

      const small = await undersizedTargets(page);
      expect(
        small,
        `${target.name} has ${small.length} undersized target(s): ${small
          .slice(0, 6)
          .map((s) => `"${s.text}" ${s.w}×${s.h}`)
          .join(", ")}`
      ).toEqual([]);
    });
  }
});

test.describe("desktop layout", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the feed uses the width instead of stranding a single column", async ({ page }) => {
    await page.goto("/");
    await settle(page);

    // The feed is a two-column layout at lg: the story column plus a 320px rail.
    // If the rail collapses, the page is a phone layout on a 1440px screen.
    const columns = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>("#feed");
      if (!grid) return null;
      return { display: getComputedStyle(grid).display, tracks: getComputedStyle(grid).gridTemplateColumns };
    });

    expect(columns, "the feed grid is missing").not.toBeNull();
    expect(columns!.display).toBe("grid");
    // Two tracks means the rail is present; one track means it collapsed.
    expect(columns!.tracks.split(" ").length).toBeGreaterThanOrEqual(2);
  });

  test("search results use two columns when there is room", async ({ page }) => {
    await page.goto("/search?q=nairobi");
    await settle(page);

    const tracks = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>("main .grid.grid-cols-1");
      return grid ? getComputedStyle(grid).gridTemplateColumns : null;
    });

    // No results is a legitimate empty state; only assert when there is a grid.
    if (tracks) expect(tracks.split(" ").length).toBeGreaterThanOrEqual(2);
  });
});
