import { readFileSync } from "node:fs";
import { join } from "node:path";
import Parser from "rss-parser";
import { describe, expect, it } from "vitest";
import {
  MAX_THUMB_NETWORK_FETCHES,
  RECOVERY_BATCH_LIMIT,
  RSS_MEDIA_CUSTOM_FIELDS,
  mediaFieldUrl,
} from "@/lib/rss-poll";

/**
 * How a syndicated story gets its cover.
 *
 * Three of the seven feeds in the registry publish no image at all — no
 * enclosure, no Media RSS, no `<img>` in the body — and the only remaining
 * source is the publisher page's `og:image`, one download per story. The rest
 * of the pipeline depends on the budget for those downloads being spent, and on
 * the images that arrive *free* actually reaching the database.
 *
 * This suite pins both, because both failed silently in production:
 *
 *   • rss-parser discards elements it was not asked to expose, so the reads of
 *     `media:thumbnail` / `media:content` resolved to `undefined` for every
 *     feed. KBC names an image for every item it publishes and every one of
 *     them imported coverless, with the correct URL sitting in XML we had
 *     already downloaded.
 *   • The recovery budget was smaller than the batch it walked, so a run
 *     selected 25 candidates and attempted 12. The other 13 were re-selected
 *     and skipped on every pass, for as long as they existed.
 */

/** A feed item shaped exactly as rss-parser hands it over (single tag). */
const SINGLE_TAG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>KBC</title>
    <item>
      <title>Kilifi County declared technically insolvent</title>
      <link>https://www.kbc.co.ke/kilifi/</link>
      <description>Story body</description>
      <media:thumbnail url="https://www.kbc.co.ke/wp-content/uploads/2026/09/senate-1.jpeg" />
    </item>
  </channel>
</rss>`;

/** A feed item that repeats the tag — rss-parser then hands over an array. */
const REPEATED_TAG_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Capital FM</title>
    <item>
      <title>Two images</title>
      <link>https://www.capitalfm.co.ke/news/story/</link>
      <media:thumbnail url="https://cdn.example.com/first.jpg" />
      <media:thumbnail url="https://cdn.example.com/second.jpg" />
    </item>
  </channel>
</rss>`;

const parserWithFields = new Parser({ customFields: { item: [...RSS_MEDIA_CUSTOM_FIELDS] } });
const parserWithoutFields = new Parser({});

describe("mediaFieldUrl", () => {
  it("reads the { $: { url } } shape rss-parser actually produces", () => {
    expect(mediaFieldUrl({ $: { url: "https://example.com/a.jpg" } })).toBe(
      "https://example.com/a.jpg"
    );
  });

  it("reads the first usable entry when a tag repeats and arrives as an array", () => {
    expect(
      mediaFieldUrl([
        { $: { url: "https://example.com/first.jpg" } },
        { $: { url: "https://example.com/second.jpg" } },
      ])
    ).toBe("https://example.com/first.jpg");
  });

  it("skips array entries that carry no URL rather than giving up on the array", () => {
    expect(mediaFieldUrl([{ $: {} }, { $: { url: "https://example.com/real.jpg" } }])).toBe(
      "https://example.com/real.jpg"
    );
  });

  it("accepts a bare string, which some feeds put in media:content", () => {
    expect(mediaFieldUrl("https://example.com/plain.jpg")).toBe("https://example.com/plain.jpg");
  });

  it("returns null for every shape that carries no URL", () => {
    for (const value of [undefined, null, {}, { $: {} }, { $: { url: "" } }, [], 42, { url: "x" }]) {
      expect(mediaFieldUrl(value)).toBeNull();
    }
  });
});

describe("the parser is asked for the Media RSS tags the code reads", () => {
  it("exposes media:thumbnail — the regression that blanked KBC's covers", async () => {
    const parsed = await parserWithFields.parseString(SINGLE_TAG_XML);
    const item = parsed.items[0] as unknown as Record<string, unknown>;
    expect(mediaFieldUrl(item["media:thumbnail"])).toBe(
      "https://www.kbc.co.ke/wp-content/uploads/2026/09/senate-1.jpeg"
    );
  });

  it("demonstrates what the missing declaration used to do: the URL is dropped entirely", async () => {
    const parsed = await parserWithoutFields.parseString(SINGLE_TAG_XML);
    const item = parsed.items[0] as unknown as Record<string, unknown>;
    // This is the bug, stated as a test. It is not the behaviour we want — it is
    // the behaviour that produced 39 coverless stories, and it is why the
    // declaration above is load-bearing rather than decorative.
    expect(item["media:thumbnail"]).toBeUndefined();
    expect(mediaFieldUrl(item["media:thumbnail"])).toBeNull();
  });

  it("still reads a repeated tag once the array shape comes back", async () => {
    const parsed = await parserWithFields.parseString(REPEATED_TAG_XML);
    const item = parsed.items[0] as unknown as Record<string, unknown>;
    expect(mediaFieldUrl(item["media:thumbnail"])).toBe("https://cdn.example.com/first.jpg");
  });

  it("declares every media: field the module indexes into items", () => {
    // The failure mode is a *mismatch*: code that reads a field the parser was
    // never told about, which reads as "this feed has no images". Asserting the
    // two agree is what stops the next media: field from joining the dead code.
    const source = readFileSync(join(process.cwd(), "src/lib/rss-poll.ts"), "utf-8");
    const readFields = new Set(
      [...source.matchAll(/item\[\s*"(media:[^"]+)"\s*\]/g)].map((m) => m[1] as string)
    );
    expect(readFields.size).toBeGreaterThan(0);
    for (const field of readFields) {
      expect(RSS_MEDIA_CUSTOM_FIELDS).toContain(field);
    }
  });
});

describe("recovery budget", () => {
  it("can attempt every candidate a default run selects", () => {
    // The original numbers (batch 25, budget 12) meant a run inspected 25
    // coverless stories and downloaded 12, leaving 13 starved on that pass and
    // every pass after it: the same rows sort to the same positions.
    expect(MAX_THUMB_NETWORK_FETCHES).toBeGreaterThanOrEqual(RECOVERY_BATCH_LIMIT);
  });

  it("keeps a batch small enough to finish inside a scheduled run", () => {
    expect(RECOVERY_BATCH_LIMIT).toBeGreaterThan(0);
    expect(RECOVERY_BATCH_LIMIT).toBeLessThanOrEqual(100);
  });
});
