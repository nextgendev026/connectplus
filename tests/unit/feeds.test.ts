import { describe, expect, it } from "vitest";
import { absoluteUrl, buildJsonFeed, buildRssFeed, escapeXml, type FeedItem, type FeedMeta } from "@/lib/feeds";

const meta: FeedMeta = {
  origin: "https://connectplus.test",
  siteName: "connectPlus",
  tagline: "Voices of the Silicon Savanna",
  description: "East African stories, radio and livescores.",
  selfPath: "/feed.xml",
};

const items: FeedItem[] = [
  {
    id: "post_1",
    title: "Mobile money rises",
    url: "/article/mobile-money-rises",
    summary: "Merchant payments drove the jump.",
    authorName: "Achieng Otieno",
    category: "Business",
    tags: ["mobile money", "fintech"],
    publishedAt: new Date("2026-09-14T06:00:00.000Z"),
    imageUrl: "/uploads/cover.png",
  },
];

describe("escapeXml", () => {
  it("escapes every XML-significant character", () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;"
    );
  });
});

describe("absoluteUrl", () => {
  it("resolves root-relative paths against the origin", () => {
    expect(absoluteUrl("https://connectplus.test", "/uploads/a.png")).toBe("https://connectplus.test/uploads/a.png");
  });

  it("leaves absolute URLs alone and drops data URIs", () => {
    expect(absoluteUrl("https://connectplus.test", "https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(absoluteUrl("https://connectplus.test", "data:image/png;base64,AAAA")).toBeNull();
  });
});

describe("buildRssFeed", () => {
  const xml = buildRssFeed(meta, items);

  it("declares the namespaces a rich item needs", () => {
    for (const ns of ["atom", "dc", "content", "media"]) {
      expect(xml).toContain(`xmlns:${ns}=`);
    }
  });

  it("uses dc:creator for a human byline, never <author>", () => {
    expect(xml).toContain("<dc:creator>Achieng Otieno</dc:creator>");
    expect(xml).not.toMatch(/<author>/);
  });

  it("absolutises image URLs and types the enclosure correctly", () => {
    expect(xml).toContain('url="https://connectplus.test/uploads/cover.png"');
    expect(xml).toContain('type="image/png"');
    expect(xml).toContain("<media:thumbnail");
  });

  it("points the self link at the feed's own URL", () => {
    expect(xml).toContain('href="https://connectplus.test/feed.xml"');
  });

  it("includes the category and tags as <category> elements", () => {
    expect(xml).toContain("<category>Business</category>");
    expect(xml).toContain("<category>fintech</category>");
  });

  it("cannot be broken out of by a hostile title", () => {
    const hostile = buildRssFeed(meta, [{ ...items[0]!, title: "</title><script>alert(1)</script>" }]);
    expect(hostile).not.toContain("<script>");
    expect(hostile).toContain("&lt;script&gt;");
  });

  it("escapes the CDATA terminator inside a description", () => {
    const hostile = buildRssFeed(meta, [{ ...items[0]!, summary: "ok ]]> still ok" }]);
    expect(hostile).not.toContain("]]> still ok");
  });

  it("labels a category feed in its channel title", () => {
    const filtered = buildRssFeed({ ...meta, selfPath: "/feed/tech", categoryLabel: "Tech" }, items);
    expect(filtered).toContain("<title>connectPlus — Tech</title>");
    expect(filtered).toContain('href="https://connectplus.test/feed/tech"');
  });
});

describe("buildJsonFeed", () => {
  const feed = JSON.parse(buildJsonFeed(meta, items)) as {
    version: string;
    feed_url: string;
    items: { id: string; url: string; image?: string; authors?: { name: string }[]; tags?: string[] }[];
  };

  it("declares the 1.1 version and absolute URLs", () => {
    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.feed_url).toBe("https://connectplus.test/feed.xml");
    expect(feed.items[0]!.url).toBe("https://connectplus.test/article/mobile-money-rises");
  });

  it("carries the author, tags and image", () => {
    expect(feed.items[0]!.authors?.[0]?.name).toBe("Achieng Otieno");
    expect(feed.items[0]!.tags).toContain("Business");
    expect(feed.items[0]!.image).toBe("https://connectplus.test/uploads/cover.png");
  });
});
