import { describe, expect, it } from "vitest";
import {
  slugify,
  truncate,
  estimateReadTime,
  stripHtml,
  generateExcerpt,
  getRandomNode,
  NODES,
} from "@/lib/utils";

describe("slugify", () => {
  it("slugs titles into url-safe kebab case", () => {
    expect(slugify("Nairobi's Tech Revolution!")).toBe("nairobis-tech-revolution");
  });

  it("handles underscores and whitespace collisions", () => {
    expect(slugify("  Hello   World__Again  ")).toBe("hello-world-again");
  });

  it("strips non-word characters and trims dashes", () => {
    expect(slugify("!!!Banking & Finance!!")).toBe("banking-finance");
  });

  it("returns empty string for empty input", () => {
    expect(slugify("")).toBe("");
  });
});

describe("estimateReadTime", () => {
  it("returns at least 1 minute", () => {
    expect(estimateReadTime("hello world")).toBe(1);
  });

  it("rounds word counts up per 200 wpm", () => {
    // 250 words at 200wpm rounds to 2 minutes.
    const text = Array.from({ length: 250 }, () => "word").join(" ");
    expect(estimateReadTime(text)).toBe(2);
  });
});

describe("stripHtml / generateExcerpt", () => {
  it("removes HTML tags and markdown tokens from excerpts", () => {
    expect(stripHtml("<p>Hello <b>world</b></p>")).toBe("Hello world");
    expect(generateExcerpt("**bold** #hash `code`", 100)).toBe("bold hash code");
  });

  it("truncates to maxLength with ellipsis", () => {
    expect(generateExcerpt("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghij...");
  });
});

describe("truncate", () => {
  it("returns input unchanged when under the limit", () => {
    expect(truncate("short", 10)).toBe("short");
  });

  it("appends ellipsis past the limit", () => {
    expect(truncate("longer-than-limit", 6)).toBe("longer...");
  });
});

describe("getRandomNode / NODES", () => {
  it("returns an East African city", () => {
    expect(NODES).toContain(getRandomNode());
  });

  it("lists the expected regional nodes", () => {
    expect(NODES).toEqual(
      expect.arrayContaining(["Nairobi", "Kampala", "Dar es Salaam", "Kigali"])
    );
  });
});