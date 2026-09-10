import { describe, expect, it } from "vitest";
import { coverSrc } from "@/lib/thumb";
import { paintThumb } from "@/lib/thumb-svg";

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
