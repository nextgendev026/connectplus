import { test, expect, type Page } from "@playwright/test";

/**
 * The sports desk must never scroll sideways on a phone.
 *
 * This is the regression, not a style preference. Four `shrink-0` market chips
 * plus a `shrink-0` sort toggle sat in a nowrap flex row with no scroll
 * container: nothing could shrink and nothing could wrap, so the row measured
 * 799px on a 390px screen and the overflow escaped every ancestor. The *whole
 * document* became sideways-scrollable, which on a phone means the page can be
 * dragged out of alignment by any vertical swipe that drifts a few degrees.
 *
 * One bad row in one board cost every board its responsiveness, which is why
 * the assertion is made against the document and not against the row.
 */

// Fixtures and picks are fetched client-side, and a cold board can take a while
// to leave its loading state — settle() alone can spend most of the default
// budget, which then reads as a timeout instead of a layout failure.
test.setTimeout(90_000);

const BOARDS = [
  { name: "scores", url: "/sports" },
  { name: "analysis", url: "/sports?tab=analysis" },
  { name: "tips", url: "/sports?tab=tips" },
  { name: "fixtures", url: "/sports?tab=calendar" },
];

const PHONES = [
  { width: 320, height: 720, label: "small phone" },
  { width: 390, height: 844, label: "phone" },
];

async function settle(page: Page) {
  await page.waitForSelector(".sports-desk", { timeout: 30_000 });
  // Fixtures and picks load client-side; waiting for the loading copy to clear
  // is what makes the measurement stable.
  await page
    .waitForFunction(() => !/(Loading|Getting today)/i.test(document.body.innerText), { timeout: 30_000 })
    .catch(() => {});
}

async function overflow(page: Page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
}

for (const phone of PHONES) {
  test.describe(`at ${phone.width}px (${phone.label})`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height } });

    for (const board of BOARDS) {
      test(`${board.name} does not scroll sideways`, async ({ page }) => {
        await page.goto(board.url);
        await settle(page);
        const { doc, viewport } = await overflow(page);
        expect(doc, `${board.name} widens the document to ${doc}px on a ${viewport}px screen`).toBeLessThanOrEqual(
          viewport + 1
        );
      });
    }
  });
}

test.describe("board chrome", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the board switcher pinned flush against the board toolbar", async ({ page }) => {
    await page.goto("/sports?tab=tips");
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(400);

    const geometry = await page.evaluate(() => {
      const nav = document.querySelector(".sports-nav");
      const toolbar = document.querySelector(".sports-toolbar");
      if (!nav || !toolbar) return null;
      const navRect = nav.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      return {
        navTop: Math.round(navRect.top),
        navHeight: Math.round(navRect.height),
        gap: Math.round(toolbarRect.top - navRect.bottom),
        navSticky: getComputedStyle(nav).position,
        toolbarSticky: getComputedStyle(toolbar).position,
      };
    });

    expect(geometry).not.toBeNull();
    // 4rem: the app navbar, which is z-50 and would cover anything at `top: 0`.
    expect(geometry!.navTop).toBe(64);
    expect(geometry!.navSticky).toBe("sticky");
    expect(geometry!.toolbarSticky).toBe("sticky");
    // Flush — the toolbar's offset is the switcher's *measured* height, so this
    // is the assertion that catches a stale hand-written constant.
    expect(Math.abs(geometry!.gap)).toBeLessThanOrEqual(1);
  });
});
