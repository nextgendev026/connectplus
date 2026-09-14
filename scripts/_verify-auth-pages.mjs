import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://127.0.0.1:3300";
const browser = await chromium.launch({ channel: process.env.CHANNEL ?? "chrome" });

const results = [];
async function check(page, label, run) {
  try {
    results.push([label, await run(page)]);
  } catch (error) {
    results.push([label, { error: String(error).slice(0, 160) }]);
  }
}

for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });

  await check(page, `sports ${width}`, async (p) => {
    await p.goto(`${BASE}/sports`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector(".sports-nav", { timeout: 20000 });
    await p.waitForFunction(() => !/Loading/i.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
    const before = await p.evaluate(() => {
      const nav = document.querySelector(".sports-nav");
      const tb = document.querySelector(".sports-toolbar");
      return { nav: nav.getBoundingClientRect().height, tb: tb?.getBoundingClientRect().top ?? null };
    });
    await p.evaluate(() => window.scrollTo(0, 2000));
    await p.waitForTimeout(350);
    const out = await p.evaluate(() => {
      const nav = document.querySelector(".sports-nav");
      const tb = document.querySelector(".sports-toolbar");
      const navRect = nav.getBoundingClientRect();
      const tbRect = tb?.getBoundingClientRect();
      return {
        scrollY: Math.round(window.scrollY),
        navTop: Math.round(navRect.top),
        navHeight: Math.round(navRect.height),
        navVar: document.querySelector(".sports-desk").style.getPropertyValue("--sports-nav-h"),
        tbTop: tbRect ? Math.round(tbRect.top) : null,
        tbGap: tbRect ? Math.round(tbRect.top - navRect.bottom) : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        fontSizes: [...document.querySelectorAll(".sports-desk .text-\\[11px\\]")].slice(0, 2).map((e) => getComputedStyle(e).fontSize),
      };
    });
    return { ...out, navBeforeScroll: Math.round(before.nav) };
  });

  await check(page, `admin ${width}`, async (p) => {
    await p.goto(`${BASE}/admin/categories`, { waitUntil: "domcontentloaded" });
    await p.waitForSelector("nav[aria-label='Admin sections']", { timeout: 20000 });
    return await p.evaluate(() => {
      const aside = document.querySelector("aside");
      const main = document.querySelector("main");
      const asideStyle = aside ? getComputedStyle(aside) : null;
      const nav = document.querySelector("nav[aria-label='Admin sections']");
      return {
        asideDisplay: asideStyle?.display,
        asidePosition: asideStyle?.position,
        asideHeight: aside ? Math.round(aside.getBoundingClientRect().height) : null,
        navScrollsInternally: nav ? nav.scrollHeight > nav.clientHeight : null,
        mainPadding: main ? getComputedStyle(main).padding : null,
        docScrolls: document.documentElement.scrollHeight > window.innerHeight,
        nestedScroller: main ? getComputedStyle(main).overflowY : null,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
  });

  await check(page, `admin home ${width}`, async (p) => {
    await p.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(1500);
    return await p.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent,
      groups: document.querySelectorAll("nav[aria-label='Admin sections'] p").length,
      hasOldBrandDot: !!document.querySelector(".bg-brand-400.animate-pulse"),
    }));
  });

  await page.close();
}

console.log(JSON.stringify(Object.fromEntries(results), null, 1));
await browser.close();
