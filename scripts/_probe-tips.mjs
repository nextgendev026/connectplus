import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

await page.goto(`${BASE}/sports?tab=tips`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".sports-desk", { timeout: 20000 });
await page.waitForTimeout(3500);

const report = await page.evaluate(() => {
  const viewport = document.documentElement.clientWidth;
  const rows = [];
  for (const el of document.querySelectorAll(".sports-desk *")) {
    const rect = el.getBoundingClientRect();
    if (rect.right <= viewport + 1) continue;
    const parent = el.parentElement;
    rows.push({
      tag: el.tagName.toLowerCase(),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
      w: Math.round(rect.width),
      right: Math.round(rect.right),
      overflowX: getComputedStyle(el).overflowX,
      parentCls: (typeof parent?.className === "string" ? parent.className : "").slice(0, 60),
      parentOverflowX: parent ? getComputedStyle(parent).overflowX : null,
    });
  }
  return { viewport, doc: document.documentElement.scrollWidth, rows };
});

console.log("viewport", report.viewport, "docScrollWidth", report.doc);
for (const row of report.rows.slice(0, 14)) console.log(JSON.stringify(row));

await browser.close();
