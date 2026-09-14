/**
 * Signed-in audit of the admin console.
 *
 * Credentials come from the environment, never from this file:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/_verify-admin-live.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD are required");
  process.exit(1);
}

const PAGES = [
  "/admin",
  "/admin/categories",
  "/admin/analytics",
  "/admin/neural",
  "/admin/ai",
  "/admin/content",
  "/admin/moderation",
  "/admin/writers",
  "/admin/rss",
  "/admin/ads",
  "/admin/subscriptions",
  "/admin/payments",
  "/admin/sports",
  "/admin/users",
  "/admin/integrations",
  "/admin/settings",
];

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text().slice(0, 140));
});

await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
await page.fill("input[type='email']", EMAIL);
await page.fill("input[type='password']", PASSWORD);
await Promise.all([
  page.waitForURL((url) => !url.pathname.includes("signin"), { timeout: 60000 }).catch(() => {}),
  page.click("button[type='submit']"),
]);
await page.waitForTimeout(2500);
const signedIn = await page.evaluate(() => !location.pathname.includes("signin"));
console.log("signed in:", signedIn, "at", page.url());

const theme = async (dark) =>
  page.evaluate((wantDark) => {
    document.documentElement.classList.toggle("dark", wantDark);
    const panel = document.querySelector("section.surface-card");
    const heading = document.querySelector("main h1");
    const muted = [...document.querySelectorAll("main p")].find((p) => p.textContent && p.textContent.length > 20);
    const navLink = document.querySelector("nav[aria-label='Admin sections'] a");
    const lum = (colour) => {
      const [r, g, b] = colour.match(/\d+/g).slice(0, 3).map(Number).map((v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const la = lum(a);
      const lb = lum(b);
      const [hi, lo] = la > lb ? [la, lb] : [lb, la];
      return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
    };
    const panelBg = panel ? getComputedStyle(panel).backgroundColor : null;
    const aside = document.querySelector("aside");
    const asideBg = aside ? getComputedStyle(aside).backgroundColor : null;
    return {
      panelBg,
      headingOnPanel: heading && panelBg ? ratio(getComputedStyle(heading).color, panelBg) : null,
      mutedOnPanel: muted && panelBg ? ratio(getComputedStyle(muted).color, panelBg) : null,
      navLinkOnAside: navLink && asideBg ? ratio(getComputedStyle(navLink).color, asideBg) : null,
    };
  }, dark);

const rows = [];
for (const path of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const light = await theme(false);
  const dark = await theme(true);
  await theme(false);
  const layout = await page.evaluate(() => ({
    heading: document.querySelector("main h1")?.textContent?.trim(),
    overflow390: 0,
    docWidth: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    nestedScroller: getComputedStyle(document.querySelector("main")).overflowY,
  }));
  rows.push({ path, ...layout, light, dark });
}

for (const row of rows) {
  console.log(
    [
      row.path.padEnd(24),
      `h1=${(row.heading ?? "—").slice(0, 22).padEnd(22)}`,
      `overflow=${row.docWidth - row.viewport}`,
      `main=${row.nestedScroller}`,
      `light h1=${row.light.headingOnPanel} muted=${row.light.mutedOnPanel} nav=${row.light.navLinkOnAside} panel=${row.light.panelBg}`,
      `dark h1=${row.dark.headingOnPanel} muted=${row.dark.mutedOnPanel} nav=${row.dark.navLinkOnAside}`,
    ].join("  ")
  );
}

// Phone width: only the drawer nav exists, so check overflow and the drawer.
const phone = await context.newPage();
await phone.setViewportSize({ width: 390, height: 844 });
const phoneRows = [];
for (const path of PAGES) {
  await phone.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await phone.waitForTimeout(1600);
  phoneRows.push(
    await phone.evaluate((p) => ({
      path: p,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      docPad: getComputedStyle(document.querySelector("main")).padding,
    }), path)
  );
}
console.log("\nphone (390px):");
for (const row of phoneRows) console.log(` ${row.path.padEnd(24)} overflow=${row.overflow} mainPad=${row.docPad}`);

console.log("\nconsole errors:", consoleErrors.length ? [...new Set(consoleErrors)].slice(0, 6) : "none");
await browser.close();
