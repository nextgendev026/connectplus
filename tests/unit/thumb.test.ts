import { describe, expect, it } from "vitest";
import { coverSrc } from "@/lib/thumb";
import { paintThumb, THUMB_HEADERS, THUMB_MISS_HEADERS } from "@/lib/thumb-svg";

/**
 * Pull the `s-maxage` out of a Cache-Control string, in seconds.
 *
 * The policy is asserted as a number rather than as a string because the string
 * is the thing that regressed: `s-maxage=604800` and `s-maxage=900` differ by a
 * factor the eye reads past, and the whole bug was one header set being used for
 * two different answers.
 */
function edgeTtl(headers: { "Cache-Control": string }): number {
  const match = /s-maxage=(\d+)/.exec(headers["Cache-Control"]);
  expect(match, `no s-maxage in "${headers["Cache-Control"]}"`).not.toBeNull();
  return Number(match![1]);
}

function decodeCode(code: string) {
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as Record<string, string>;
}

describe("coverSrc", () => {
  it("prefers the real cover image", () => {
    expect(coverSrc("https://example.com/a.jpg", { title: "T" })).toBe("https://example.com/a.jpg");
  });

  it("mints a query-free optimizer-safe URL when there is no cover", () => {
    const url = coverSrc(null, { title: "Hello World", category: "Tech", seed: "x" });
    expect(url.startsWith("/api/thumb/")).toBe(true);
    expect(url).not.toContain("?");
    const code = url.slice("/api/thumb/".length);
    const data = decodeCode(code);
    expect(data.t).toBe("Hello World");
    expect(data.c).toBe("Tech");
    expect(data.s).toBe("x");
  });

  it("paints an SVG carrying the title and category", () => {
    const svg = paintThumb({ title: "Hello World", category: "Tech", author: "", seed: "x" });
    expect(svg).toContain("<svg");
    expect(svg).toContain("Hello World");
    expect(svg).toContain("TECH");
  });

  it("escapes hostile text in the SVG", () => {
    const svg = paintThumb({ title: "<script>alert(1)</script>", category: "T", author: "", seed: "x" });
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });
});

describe("thumbnail cache policy", () => {
  it("keeps the negative answer short-lived", () => {
    // `/api/thumb/post/<id>` answers cover OR placeholder at the same URL, and a
    // story that arrived without a cover can be backfilled by
    // `thumbnail-recovery` at any time. While the placeholder carried the
    // cover's seven-day policy, that repair was invisible: the CDN kept serving
    // the week-old placeholder, so a fixed story looked broken until the cache
    // expired. Fifteen minutes at the edge, not a week.
    expect(edgeTtl(THUMB_MISS_HEADERS)).toBeLessThanOrEqual(900);
    expect(THUMB_MISS_HEADERS["X-Thumb-Source"]).toBe("placeholder");
  });

  it("keeps the covered answer long-lived, because covers are what save the bytes", () => {
    // The opposite direction matters just as much: this route is what keeps
    // multi-megabyte cover rows out of every feed payload, and a short TTL there
    // would trade a visible bug for an invisible egress bill.
    expect(edgeTtl(THUMB_HEADERS)).toBeGreaterThanOrEqual(300);
    expect(THUMB_HEADERS["X-Thumb-Source"]).toBe("painted");
  });

  it("never lets the two policies be the same header set", () => {
    // The bug was exactly this: one header object used for both answers. If a
    // future edit collapses them, the distinction has to fail here.
    expect(THUMB_MISS_HEADERS["Cache-Control"]).not.toBe(THUMB_HEADERS["Cache-Control"]);
  });
});
