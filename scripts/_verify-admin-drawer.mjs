import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/admin/categories`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("nav[aria-label='Admin sections']", { state: "attached", timeout: 20000 });

const closed = await page.evaluate(() => ({
  asideVisible: getComputedStyle(document.querySelector("aside")).display,
  dialogOpen: !!document.querySelector("[role=dialog]"),
  bodyOverflow: getComputedStyle(document.body).overflow,
}));

await page.getByLabel("Open admin navigation").click();
await page.waitForTimeout(400);
const open = await page.evaluate(() => {
  const dialog = document.querySelector("[role=dialog]");
  const panel = dialog?.querySelector("div");
  const link = dialog?.querySelector("a");
  const rect = panel?.getBoundingClientRect();
  return {
    dialogOpen: !!dialog,
    panelWidth: rect ? Math.round(rect.width) : null,
    panelLeft: rect ? Math.round(rect.left) : null,
    groups: dialog ? dialog.querySelectorAll("p").length : 0,
    linkCount: dialog ? dialog.querySelectorAll("a").length : 0,
    linkHeight: link ? Math.round(link.getBoundingClientRect().height) : null,
    bodyOverflow: getComputedStyle(document.body).overflow,
    animation: panel ? getComputedStyle(panel).animationName : null,
  };
});

await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const afterEscape = await page.evaluate(() => ({
  dialogOpen: !!document.querySelector("[role=dialog]"),
  bodyOverflow: getComputedStyle(document.body).overflow,
}));

console.log(JSON.stringify({ closed, open, afterEscape }, null, 1));
await browser.close();
