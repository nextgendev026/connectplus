import { describe, it, expect } from "vitest";
import { processContent, excerptFromHtml } from "@/lib/content-processor";

describe("processContent", () => {
  it("returns empty result for empty input", () => {
    expect(processContent("")).toEqual({ html: "", text: "", hasImages: false, wordCount: 0 });
  });

  it("splits plain text into paragraphs", () => {
    const { html } = processContent("Hello world.\n\nSecond paragraph.");
    expect(html).toContain("<p>Hello world.</p>");
    expect(html).toContain("<p>Second paragraph.</p>");
  });

  it("strips script and style tags", () => {
    const { html } = processContent("<p>hi</p><script>alert(1)</script><style>.x{}</style>");
    expect(html).not.toContain("script");
    expect(html).not.toContain("alert");
    expect(html).not.toContain(".x{}");
    expect(html).toContain("<p>hi</p>");
  });

  it("drops disallowed attributes and event handlers", () => {
    const { html } = processContent('<a href="https://x.com" onclick="evil()" style="color:red" class="foo">link</a>');
    expect(html).toContain("https://x.com");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("evil");
    expect(html).not.toContain("style=");
    expect(html).not.toContain('class="foo"');
  });

  it("sanitizes javascript: URLs", () => {
    const { html } = processContent('<a href="javascript:alert(1)">bad</a>');
    expect(html).not.toContain("javascript:");
  });

  it("converts markdown headings and lists", () => {
    const { html } = processContent("# Title\n\n- one\n- two");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("converts markdown inline bold and links", () => {
    const { html } = processContent("a **bold** and [link](https://example.com)");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com"');
  });

  it("detects images in HTML content", () => {
    const { html, hasImages } = processContent('<p>pic</p><img src="https://x/y.jpg" alt="y" />');
    expect(hasImages).toBe(true);
    expect(html).toContain("<img");
  });

  it("computes wordCount from actual visible words", () => {
    const { wordCount } = processContent("one two three four");
    expect(wordCount).toBe(4);
  });

  it("excerptFromHtml strips tags and truncates", () => {
    const s = excerptFromHtml("<p>The quick brown fox jumps over the lazy dog.</p>", 10);
    expect(s).not.toContain("<");
    expect(s.length).toBeLessThanOrEqual(30);
  });

  it("treats markdown as non-image by default", () => {
    const { hasImages } = processContent("just some text");
    expect(hasImages).toBe(false);
  });
});
