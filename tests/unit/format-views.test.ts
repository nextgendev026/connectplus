import { describe, expect, it } from "vitest";
import { formatCompact, formatExactViews, formatViews, viewsTitle } from "../../src/lib/format-views";

describe("view-count formatting", () => {
  it("leaves counts under a thousand alone", () => {
    expect(formatViews(0)).toBe("0");
    expect(formatViews(7)).toBe("7");
    expect(formatViews(999)).toBe("999");
  });

  it("compacts thousands and millions", () => {
    expect(formatViews(1000)).toBe("1K");
    expect(formatViews(1234)).toBe("1.2K");
    expect(formatViews(15_400)).toBe("15.4K");
    expect(formatViews(1_200_000)).toBe("1.2M");
  });

  it("never prints a meaningless decimal", () => {
    // The bug this replaces: `${(1000 / 1000).toFixed(1)}K` rendered "1.0K".
    expect(formatViews(1000)).not.toContain(".0");
    expect(formatViews(2_000_000)).toBe("2M");
  });

  it("crosses to millions before the thousands branch can print 1000K", () => {
    expect(formatViews(999_500)).toBe("1M");
    expect(formatViews(999_499)).toBe("999.5K");
    expect(formatViews(999_999)).toBe("1M");
  });

  it("survives counts that are not numbers", () => {
    expect(formatViews(Number.NaN)).toBe("0");
    expect(formatViews(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatViews(-5)).toBe("0");
    expect(formatViews(12.7)).toBe("12");
  });

  it("keeps the exact figure available for a tooltip", () => {
    expect(formatExactViews(1234)).toBe("1,234");
    expect(formatExactViews(1_234_567)).toBe("1,234,567");
  });

  it("titles a badge with the exact count only when it differs", () => {
    expect(viewsTitle(42)).toBe("42 views");
    expect(viewsTitle(1)).toBe("1 view");
    expect(viewsTitle(1234)).toBe("1,234 views (1.2K shown)");
  });

  it("uses the same compactor for every other engagement counter", () => {
    // Likes and story counts used their own copy-pasted compaction before, so a
    // rail could show 1.2K next to a badge showing 1,234.
    expect(formatCompact).toBe(formatViews);
    expect(formatCompact(1234)).toBe("1.2K");
  });
});
