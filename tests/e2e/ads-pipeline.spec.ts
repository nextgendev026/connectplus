import { expect, test, type Page } from "@playwright/test";

/**
 * The ad pipeline from the browser's side, on `/radio` — the page that uses the
 * client placement path (`AdSlotClient`), because it is itself a client
 * component.
 *
 * Hermetic by construction: the resolved pool is fulfilled in the browser and
 * every beacon is captured instead of sent, so nothing reaches a database and no
 * creative has to exist in production to test the pipeline that serves one. What
 * is *not* stubbed is the part under test — the real selection, the real
 * frequency ledger, the real IntersectionObserver, the real consent gate.
 */

const SLOT = "radio-hero";

/**
 * How long the first assertion may take.
 *
 * The pipeline is client-side, so nothing appears until React hydrates — and
 * against a Turbopack dev server the route may still be compiling on the first
 * hit, which is minutes away from a production build and nothing to do with the
 * code under test. CI builds and starts, so this is dev-server headroom only.
 */
const HYDRATE = 25_000;

const HOUSE = [
  {
    id: "ad-alpha",
    name: "Alpha Bank",
    slot: SLOT,
    format: "image",
    imageUrl: "https://cdn.example.test/alpha.png",
    html: null,
    targetUrl: "https://alpha.example.test",
    sponsor: "Alpha",
    weight: 1,
  },
  {
    id: "ad-beta",
    name: "Beta Telecom",
    slot: SLOT,
    format: "image",
    imageUrl: "https://cdn.example.test/beta.png",
    html: null,
    targetUrl: "https://beta.example.test",
    sponsor: "Beta",
    weight: 1,
  },
];

interface Beacon {
  kind?: string;
  adId?: string;
  networkSlotId?: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fulfil the placement request and capture beacons.
 *
 * Only the slot under test gets a pool: every other placement on the page is
 * answered with nothing, so a beacon can be attributed to this slot without
 * ambiguity (the beacon carries the creative's id, not the slot's).
 */
async function stubAds(
  page: Page,
  payload: { creatives?: unknown[]; network?: unknown }
): Promise<Beacon[]> {
  const beacons: Beacon[] = [];

  await page.route("**/api/ads/slots?**", async (route) => {
    const slot = new URL(route.request().url()).searchParams.get("slot");
    const resolution =
      slot === SLOT
        ? { creatives: payload.creatives ?? [], network: payload.network ?? null, reserve: true }
        : null;
    await route.fulfill({ json: { resolution } });
  });

  await page.route("**/api/ads/metrics", async (route) => {
    try {
      beacons.push(route.request().postDataJSON() as Beacon);
    } catch {
      beacons.push({});
    }
    await route.fulfill({ json: { ok: true, counted: true } });
  });

  return beacons;
}

/** Seed the per-reader frequency ledger before any page script runs. */
async function seedLedger(page: Page, counts: Record<string, number>): Promise<void> {
  const ledger = Object.fromEntries(
    Object.entries(counts).map(([key, count]) => [`${SLOT}:${key}`, { count, day: today() }])
  );
  await page.addInitScript((value) => {
    try {
      window.localStorage.setItem("connectplus:ad-caps", value);
    } catch {
      /* private mode */
    }
  }, JSON.stringify(ledger));
}

async function allowAdvertising(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem(
        "connectplus-cookie-consent",
        JSON.stringify({ essential: true, analytics: true, advertising: true, savedAt: new Date().toISOString() })
      );
    } catch {
      /* private mode */
    }
  });
}

test("serves a creative and reports a viewable impression for the one on screen", async ({ page }) => {
  const beacons = await stubAds(page, { creatives: HOUSE });
  await page.goto("/radio");

  const unit = page.locator(`[data-ad-slot='${SLOT}']`);
  await expect(unit).toBeVisible({ timeout: HYDRATE });

  // Exactly one creative is placed, whichever the rotation picked.
  const image = unit.locator("img");
  await expect(image).toHaveCount(1, { timeout: HYDRATE });
  const name = await image.getAttribute("alt");
  const chosen = HOUSE.find((creative) => creative.name === name);
  expect(chosen, `unexpected creative "${name}"`).toBeTruthy();

  await unit.scrollIntoViewIfNeeded();

  // Nothing is reported until the creative has been half-visible for a second.
  await expect.poll(() => beacons.length, { timeout: 10_000 }).toBeGreaterThan(0);
  const impression = beacons.find((beacon) => beacon.kind === "impression");
  expect(impression).toBeTruthy();
  expect(impression!.adId).toBe(chosen!.id);

  // The sponsor is disclosed on the unit, not only in the markup.
  await expect(unit).toContainText("Sponsored");
});

test("stops serving a creative once the reader has reached its cap", async ({ page }) => {
  const beacons = await stubAds(page, { creatives: HOUSE });
  // Both campaigns already at the default cap of three for this reader today.
  await seedLedger(page, { "ad-alpha": 3, "ad-beta": 3 });

  await page.goto("/radio");

  const unit = page.locator(`[data-ad-slot='${SLOT}']`);
  await expect(unit).toBeVisible({ timeout: HYDRATE });
  await expect(unit.locator("img")).toHaveCount(0);

  await unit.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2000);
  expect(beacons).toEqual([]);
});

test("rotates to the campaign the reader has not seen when one is capped", async ({ page }) => {
  const beacons = await stubAds(page, { creatives: HOUSE });
  // "ad-alpha" is spent, so whichever way the rotation falls the answer is beta.
  await seedLedger(page, { "ad-alpha": 3, "ad-beta": 0 });

  await page.goto("/radio");

  const unit = page.locator(`[data-ad-slot='${SLOT}']`);
  await expect(unit.locator("img")).toHaveCount(1, { timeout: HYDRATE });
  await expect(unit.locator("img")).toHaveAttribute("alt", "Beta Telecom");

  await unit.scrollIntoViewIfNeeded();
  await expect.poll(() => beacons.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(beacons[0]?.adId).toBe("ad-beta");
});

test("mounts a network tag only after the reader allows advertising cookies", async ({ page }) => {
  const network = {
    id: "net-1",
    provider: "adsense",
    scriptTag: '<div id="network-tag">network creative</div>',
    adUnitId: null,
    sizes: "[[300,250]]",
  };

  await stubAds(page, { creatives: [], network });
  await page.goto("/radio");

  const unit = page.locator(`[data-ad-slot='${SLOT}']`);
  await expect(unit).toBeVisible({ timeout: HYDRATE });
  // No consent recorded: a third-party tag must not be injected.
  await page.waitForTimeout(1500);
  await expect(page.locator("#network-tag")).toHaveCount(0);
});

test("mounts and counts the network tag once advertising is allowed", async ({ page }) => {
  const network = {
    id: "net-1",
    provider: "adsense",
    scriptTag: '<div id="network-tag">network creative</div>',
    adUnitId: null,
    sizes: "[[300,250]]",
  };

  const beacons = await stubAds(page, { creatives: [], network });
  await allowAdvertising(page);
  await page.goto("/radio");

  const unit = page.locator(`[data-ad-slot='${SLOT}']`);
  await expect(unit).toBeVisible({ timeout: HYDRATE });
  await expect(page.locator("#network-tag")).toBeVisible({ timeout: HYDRATE });

  await unit.scrollIntoViewIfNeeded();
  await expect.poll(() => beacons.length, { timeout: 10_000 }).toBeGreaterThan(0);
  expect(beacons[0]?.networkSlotId).toBe("net-1");
});
