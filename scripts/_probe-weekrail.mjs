import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });

for (const width of [320, 390, 430]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  await page.goto(`${BASE}/sports?tab=calendar`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".sports-desk", { timeout: 30000 });
  await page
    .waitForFunction(() => !/Loading|Getting/i.test(document.body.innerText), { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1200);

  const report = await page.evaluate(() => {
    const cells = [...document.querySelectorAll("[data-active]")];
    const rail = cells[0]?.parentElement;
    if (!rail) return { error: "no rail" };
    const active = rail.querySelector('[data-active="true"]');
    const railRect = rail.getBoundingClientRect();
    const activeRect = active?.getBoundingClientRect();
    const weekday = cells[0].querySelector("span");
    const date = cells[0].querySelectorAll("span")[1];
    return {
      cells: cells.length,
      cellWidth: Math.round(cells[0].getBoundingClientRect().width),
      railWidth: Math.round(railRect.width),
      railScrollWidth: rail.scrollWidth,
      scrolls: rail.scrollWidth > rail.clientWidth + 1,
      scrollLeft: Math.round(rail.scrollLeft),
      activeCentred:
        activeRect ? Math.abs(activeRect.left + activeRect.width / 2 - (railRect.left + railRect.width / 2)) : null,
      weekdayFont: weekday ? getComputedStyle(weekday).fontSize : null,
      weekdayFits: weekday ? weekday.getBoundingClientRect().width <= cells[0].getBoundingClientRect().width - 4 : null,
      dateFont: date ? getComputedStyle(date).fontSize : null,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      scrollbarHidden: rail.scrollWidth > rail.clientWidth && getComputedStyle(rail).scrollbarWidth,
    };
  });

  console.log(width, JSON.stringify(report));
  await page.close();
}

await browser.close();
