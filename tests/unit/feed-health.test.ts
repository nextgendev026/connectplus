import { afterEach, describe, expect, it, vi } from "vitest";
import {
  countBrokenLinks,
  validateJsonFeed,
  validateRss,
  worseFeedState,
} from "@/lib/feed-health";

const VALID_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>connectPlus</title>
    <link>https://connectplus.test</link>
    <atom:link href="https://connectplus.test/feed.xml" rel="self" type="application/rss+xml" />
    <item>
      <title>Mobile money rises</title>
      <link>https://connectplus.test/article/mobile-money-rises</link>
      <guid isPermaLink="true">https://connectplus.test/article/mobile-money-rises</guid>
      <pubDate>Fri, 11 Sep 2026 17:26:47 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const VALID_JSON = JSON.stringify({
  version: "https://jsonfeed.org/version/1.1",
  title: "connectPlus",
  feed_url: "https://connectplus.test/feed.xml?format=json",
  items: [
    {
      id: "post_1",
      url: "https://connectplus.test/article/mobile-money-rises",
      title: "Mobile money rises",
      date_published: "2026-09-11T17:26:47.000Z",
    },
  ],
});

describe("validateRss", () => {
  it("accepts a well-formed feed and reports its items and self link", () => {
    const v = validateRss(VALID_RSS);
    expect(v.ok).toBe(true);
    expect(v.itemCount).toBe(1);
    expect(v.selfLink).toBe("https://connectplus.test/feed.xml");
    expect(v.links).toEqual(["https://connectplus.test/article/mobile-money-rises"]);
  });

  it("flags an item missing the fields a consumer needs", () => {
    const broken = VALID_RSS.replace("<guid isPermaLink=\"true\">https://connectplus.test/article/mobile-money-rises</guid>", "");
    const v = validateRss(broken);
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/no <guid>/i);
  });

  it("flags a document that is not RSS at all", () => {
    const v = validateRss("<html><body>error</body></html>");
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/rss version/i);
  });

  it("flags an empty body and a feed with no items", () => {
    expect(validateRss("").ok).toBe(false);
    const noItems = VALID_RSS.replace(/<item>[\s\S]*?<\/item>/, "");
    const v = validateRss(noItems);
    expect(v.itemCount).toBe(0);
    expect(v.errors.join(" ")).toMatch(/no <item>/i);
  });

  it("requires the atom self link", () => {
    const noSelf = VALID_RSS.replace(/<atom:link[^>]*\/>/, "");
    expect(validateRss(noSelf).errors.join(" ")).toMatch(/rel="self"/i);
  });

  it("decodes entities in extracted links", () => {
    const withEntity = VALID_RSS.replace(
      "https://connectplus.test/article/mobile-money-rises</link>",
      "https://connectplus.test/article/mobile-money-rises?a=1&amp;b=2</link>"
    );
    expect(validateRss(withEntity).links[0]).toContain("a=1&b=2");
  });
});

describe("validateJsonFeed", () => {
  it("accepts a valid JSON Feed and reports its items", () => {
    const v = validateJsonFeed(VALID_JSON);
    expect(v.ok).toBe(true);
    expect(v.itemCount).toBe(1);
    expect(v.feedUrl).toBe("https://connectplus.test/feed.xml?format=json");
    expect(v.links).toEqual(["https://connectplus.test/article/mobile-money-rises"]);
  });

  it("rejects a body that is not JSON", () => {
    const v = validateJsonFeed("<html>oops</html>");
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/not valid JSON/i);
  });

  it("rejects a missing or unrecognised version", () => {
    expect(validateJsonFeed(JSON.stringify({ items: [] })).errors.join(" ")).toMatch(/version/i);
    expect(
      validateJsonFeed(JSON.stringify({ version: "http://example.com/feed", items: [] })).errors.join(" ")
    ).toMatch(/version/i);
  });

  it("flags items missing required fields", () => {
    const v = validateJsonFeed(
      JSON.stringify({
        version: "https://jsonfeed.org/version/1.1",
        feed_url: "https://connectplus.test/feed.xml?format=json",
        items: [{ id: "x" }],
      })
    );
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/no url/i);
    expect(v.errors.join(" ")).toMatch(/no title/i);
    expect(v.errors.join(" ")).toMatch(/no date_published/i);
  });
});

describe("worseFeedState", () => {
  it("keeps the more severe of two states", () => {
    expect(worseFeedState("ok", "warn")).toBe("warn");
    expect(worseFeedState("critical", "warn")).toBe("critical");
    expect(worseFeedState("ok", "ok")).toBe("ok");
  });
});

describe("countBrokenLinks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("counts the links that do not resolve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({ status: url.endsWith("/bad") ? 404 : 200 }))
    );
    const result = await countBrokenLinks(
      ["https://connectplus.test/a", "https://connectplus.test/bad"],
      5
    );
    expect(result.checked).toBe(2);
    expect(result.broken).toBe(1);
  });

  it("only samples the requested number of links", async () => {
    const fetchMock = vi.fn(async () => ({ status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await countBrokenLinks(
      ["https://x.test/1", "https://x.test/2", "https://x.test/3", "https://x.test/4"],
      2
    );
    expect(result.checked).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
