import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ViewCount } from "@/components/ui/ViewCount";

/**
 * View counts are the app's most-repeated fragment of UI — one badge on every
 * card, in every list, on every board — and they were rebuilt by hand fourteen
 * times. `formatViews` only ever fixed the number; the badge around it still
 * disagreed about the noun, the icon size and the tooltip, which is exactly what
 * "the same story shows a different number on each page" looks like from the
 * reader's side.
 *
 * These tests pin both halves: what the badge renders, and the architectural
 * rule that nothing outside it may format a view count again.
 */

function render(props: Parameters<typeof ViewCount>[0]): string {
  return renderToStaticMarkup(createElement(ViewCount, props));
}

/** Visible text only. */
function visibleText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("ViewCount", () => {
  it("always says the word, so the eye glyph is never the only clue", () => {
    expect(visibleText(render({ value: 12 }))).toBe("12 views");
    expect(visibleText(render({ value: 0 }))).toBe("0 views");
  });

  it("singularises a lone view", () => {
    expect(visibleText(render({ value: 1 }))).toBe("1 view");
  });

  it("compacts the figure and keeps the exact one in the label", () => {
    const html = render({ value: 1234 });
    expect(visibleText(html)).toBe("1.2K views");
    // Both the tooltip and the accessible name carry the exact count, so the
    // compact form is a convenience and never the only copy of the number.
    expect(html).toContain('title="1,234 views (1.2K shown)"');
    expect(html).toContain('aria-label="1,234 views (1.2K shown)"');
  });

  it("drops the redundant tooltip when compact and exact agree", () => {
    const html = render({ value: 42 });
    expect(html).toContain('title="42 views"');
    expect(html).not.toContain("shown");
  });

  it("survives the nulls an unloaded list hands it", () => {
    expect(visibleText(render({ value: null }))).toBe("0 views");
    expect(visibleText(render({ value: undefined }))).toBe("0 views");
  });

  it("offers exactly two sizes", () => {
    expect(render({ value: 5 })).toContain("h-3.5 w-3.5");
    expect(render({ value: 5, size: "md" })).toContain("h-4 w-4");
  });

  it("hides the icon from assistive tech", () => {
    // Otherwise every row in a feed announces "eye, 12 views".
    expect(render({ value: 5 })).toContain('aria-hidden="true"');
  });
});

describe("view-count formatting has one home", () => {
  const SRC = join(process.cwd(), "src");

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(path)) out.push(path);
    }
    return out;
  }

  const files = walk(SRC);

  it("finds the source tree (so the rule below cannot pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("is the only component that formats or wraps a view count", () => {
    const offenders = files.filter((path) => {
      const rel = path.replace(/\\/g, "/");
      if (rel.endsWith("components/ui/ViewCount.tsx")) return false;
      if (rel.endsWith("lib/format-views.ts")) return false;
      const body = readFileSync(path, "utf8");
      return /formatViews\(|viewsTitle\(|formatExactViews\(/.test(body);
    });

    // The exact list is empty. If this fails, a surface has grown its own badge
    // again — and the number it draws will drift from the other pages.
    expect(offenders.map((p) => p.replace(/\\/g, "/"))).toEqual([]);
  });

  it("renders every reader-facing view count through the component", () => {
    const surfaces = [
      "src/components/blog/PostCard.tsx",
      "src/components/feed/LoadMoreFeed.tsx",
      "src/components/feed/HeroSlideshow.tsx",
      "src/components/feed/TrendingTopics.tsx",
      "src/components/profile/ProfileHeader.tsx",
      "src/components/profile/ProfilePostCard.tsx",
      "src/components/profile/ProfileListModal.tsx",
      "src/app/(public)/categories/page.tsx",
      "src/app/(public)/trending/page.tsx",
      // The home feed and the article page no longer draw their own counts.
      // Both are served from the CDN now, so the count has to be either a
      // component the browser can re-render (the feed's cards) or one that can
      // report the read itself (the article badge) — and both of those render
      // `ViewCount`, which is what this rule is here to protect.
      "src/components/feed/FeedCards.tsx",
      "src/components/ui/ArticleViews.tsx",
    ];

    for (const rel of surfaces) {
      const body = readFileSync(join(process.cwd(), rel), "utf8");
      expect(body, `${rel} should use <ViewCount>`).toContain("<ViewCount");
      // No hand-rolled badge: the pattern that used to be copied around was an
      // eye icon sitting next to a count inside its own span.
      expect(body, `${rel} still draws its own badge`).not.toMatch(/<Eye\b/);
    }
  });
});
