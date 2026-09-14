import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const WIDTH = Number(process.env.W ?? 320);
const TABS = (process.env.TABS ?? "scores,analysis,tips,calendar").split(",");

const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });
const page = await browser.newPage({ viewport: { width: WIDTH, height: 800 } });

for (const tab of TABS) {
  await page.goto(`${BASE}/sports${tab === "scores" ? "" : `?tab=${tab}`}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sports-desk", { timeout: 30000 });
  await page
    .waitForFunction(() => !/(Loading|Getting today)/i.test(document.body.innerText), { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(600);

  const report = await page.evaluate((width) => {
    const doc = document.documentElement.scrollWidth;
    const rows = [];
    if (doc <= width + 1) return { doc, overflow: 0, rows };
    for (const el of document.querySelectorAll(".sports-desk *")) {
      const rect = el.getBoundingClientRect();
      if (rect.right <= width + 1) continue;
      const parent = el.parentElement;
      // Only report the outermost offender on each branch: a wide parent makes
      // every descendant look wide too.
      const parentWide = parent && parent.getBoundingClientRect().right > width + 1;
      if (parentWide) continue;
      rows.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 90),
        w: Math.round(rect.width),
        right: Math.round(rect.right),
        overflowX: getComputedStyle(el).overflowX,
      });
    }
    return { doc, overflow: doc - width, rows };
  }, WIDTH);

  console.log(`\n=== ${tab} @${WIDTH} === doc=${report.doc} overflow=${report.overflow}`);
  for (const row of report.rows.slice(0, 8)) console.log(JSON.stringify(row));
}

await browser.close();
