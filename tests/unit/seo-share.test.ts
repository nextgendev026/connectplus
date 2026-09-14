import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({
  getSiteConfig: vi.fn(async () => ({
    siteName: "connectPlus",
    siteUrl: "https://connectplus.test/",
    ogImage: "/pwa-512.png",
    siteTagline: "Voices of the Silicon Savanna",
    siteDescription: "East Africa's home for homegrown stories.",
  })),
}));

const { articleShareCard, stripSourcePromo, webPageJsonLd } = await import("@/lib/seo");

describe("share descriptions never carry the origin's URL", () => {
  it("drops a full URL and the trailer wrapped around it", () => {
    const excerpt =
      "Kenya's mobile money volume rose 12% in the quarter, driven by merchant payments. Read more at https://www.businessdailyafrica.com/economy/mobile-money-rises";
    const clean = stripSourcePromo(excerpt);
    expect(clean).toContain("mobile money volume rose 12%");
    expect(clean).not.toMatch(/https?:|businessdailyafrica|Read more/i);
  });

  it("drops a bare domain and any path hanging off it", () => {
    const clean = stripSourcePromo("Full results at nation.africa/kenya/sports or kbc.co.ke");
    expect(clean).not.toMatch(/nation\.africa|kbc\.co\.ke/);
  });

  it("leaves ordinary prose alone", () => {
    const prose =
      "Safaricom reported Ksh 34.5 billion in profit. The NSE 20 share index closed up 0.6% and analysts expect the rally to hold.";
    expect(stripSourcePromo(prose)).toBe(prose);
  });

  it("strips HTML and markdown dressing that would render as noise", () => {
    const clean = stripSourcePromo("<p>The <strong>matches</strong> resume at 4 p.m.</p> [source](https://x.com/a)");
    expect(clean).toBe("The matches resume at 4 p.m.");
  });

  it("trims long text at a sentence boundary rather than mid-word", () => {
    const clean = stripSourcePromo(`${"Miracle. ".repeat(60)}tail`, 120);
    expect(clean.length).toBeLessThanOrEqual(121);
    expect(clean.endsWith("…")).toBe(true);
    expect(clean).not.toContain("  ");
  });

  it("handles nothing at all", () => {
    expect(stripSourcePromo(null)).toBe("");
    expect(stripSourcePromo(undefined)).toBe("");
    expect(stripSourcePromo("   ")).toBe("");
  });
});

describe("article share cards describe our article, not the publisher's", () => {
  const post = {
    id: "post_1",
    slug: "mobile-money-rises",
    title: "Mobile money rises 12%",
    excerpt: "Merchant payments drove the jump. Read more at https://businessdailyafrica.com/economy",
    content: null,
    publishedAt: new Date("2026-09-14T06:00:00.000Z"),
    author: { name: "Achieng Otieno", username: "achieng" },
    category: { name: "Business" },
    tags: [{ name: "mobile money" }],
  };

  it("returns our canonical URL and our own thumbnail", async () => {
    const card = await articleShareCard(post);
    expect(card.url).toBe("https://connectplus.test/article/mobile-money-rises");
    expect(card.canonical).toBe(card.url);
    expect(card.image).toBe("https://connectplus.test/api/thumb/post/post_1");
    expect(card.description).not.toMatch(/https?:|businessdailyafrica/i);
  });

  it("exposes no field naming the syndicated origin", async () => {
    // A syndicated post arrives knowing where it came from; the card is what
    // leaves the building, so it must not carry that onward.
    const syndicated = {
      ...post,
      ...({ source: "Business Daily", sourceUrl: "https://businessdailyafrica.com/economy" } as object),
    };
    const card = await articleShareCard(syndicated);
    expect(Object.keys(card)).not.toContain("source");
    expect(Object.keys(card)).not.toContain("sourceUrl");
    expect(JSON.stringify(card)).not.toMatch(/businessdailyafrica/);
  });

  it("falls back to our own sentence when a story has no usable text", async () => {
    const card = await articleShareCard({ ...post, excerpt: null, content: null });
    expect(card.description).toBe('Read "Mobile money rises 12%" on connectPlus — Business');
  });
});

describe("static page structured data", () => {
  it("escapes anything that could close the script tag it lives in", () => {
    const json = webPageJsonLd({
      url: "https://connectplus.test/privacy",
      name: "</script><script>alert(1)</script>",
      description: "How we handle your data.",
      siteName: "connectPlus",
      updated: "2026-09-14",
    });
    expect(json).not.toContain("</script>");
    expect(json).toContain("\\u003c/script>");
  });

  it("names the page, its breadcrumb and where it sits", () => {
    const json = JSON.parse(
      webPageJsonLd({
        url: "https://connectplus.test/cookies",
        name: "Cookies Policy",
        description: "Every cookie and storage key we use.",
        siteName: "connectPlus",
        updated: "2026-09-14",
      })
    ) as { "@graph": { "@type": string; url?: string; itemListElement?: unknown[] }[] };
    const page = json["@graph"][0]!;
    const breadcrumb = json["@graph"][1]!;
    expect(page["@type"]).toBe("WebPage");
    expect(page.url).toBe("https://connectplus.test/cookies");
    expect(breadcrumb["@type"]).toBe("BreadcrumbList");
    expect(breadcrumb.itemListElement).toHaveLength(2);
  });
});
