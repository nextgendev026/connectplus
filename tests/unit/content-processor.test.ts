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

  it("never emits a frame, closed or not", () => {
    // `iframe` was in the allow-list *and* in the skip set. The pre-strip only
    // covers paired/self-closed forms, so a bare tag survived into the body —
    // a stored-XSS and clickjacking vector for anything syndicated in.
    const unclosed = processContent('<p>hi</p><iframe src="https://attacker.test/evil">');
    expect(unclosed.html).not.toContain("iframe");
    expect(unclosed.html).not.toContain("attacker.test");

    const paired = processContent('<iframe src="https://attacker.test/evil"></iframe><p>after</p>');
    expect(paired.html).not.toContain("iframe");
    expect(paired.html).toContain("<p>after</p>");
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

/**
 * The AI writer publishes markdown where a heading or list item shares a
 * blank-line run with the prose around it (`### Heading  ` then its paragraph,
 * bullets followed by the next section). That shape used to publish literal
 * `### Introduction` and `- **FinTech hubs:**` text on the article page.
 */
describe("processContent — AI-writer markdown bodies", () => {
  const body = [
    "## Investing in Blockchain in Kenya  ",
    "",
    "### Introduction  ",
    "Kenya's tech ecosystem is booming, and **blockchain** is one of the fastest-growing sectors.",
    "",
    "### 1. Grasp the Local Landscape  ",
    "- **FinTech hubs:** Nairobi hosts dozens of platforms.  ",
    "- **Agritech:** Projects like **Twiga Foods** use it for traceability.",
    "",
    "> A quoted line",
    "",
    "1. First step",
    "2. Second step",
    "",
    "```ts",
    "const literal = '**not bold**';",
    "```",
    "",
    "---",
  ].join("\n");

  it("renders headings, lists and quotes that share a run with their text", () => {
    const { html } = processContent(body);
    expect(html).toContain("<h2>Investing in Blockchain in Kenya</h2>");
    expect(html).toContain("<h3>Introduction</h3>");
    expect(html).toContain("<strong>blockchain</strong>");
    expect(html).toContain("<h3>1. Grasp the Local Landscape</h3>");
    expect(html).toContain("<ul><li><strong>FinTech hubs:</strong>");
    expect(html).toContain("<ol><li>First step</li><li>Second step</li></ol>");
    expect(html).toContain("<blockquote>A quoted line</blockquote>");
    expect(html).toContain("<hr />");
  });

  it("never leaks raw markdown markers outside code blocks", () => {
    const { html } = processContent(body);
    expect(html).not.toContain("###");
    expect(html).toContain("<pre><code>const literal = &#39;**not bold**&#39;;</code></pre>");
  });

  it("honours hard breaks and leaves soft wraps collapsed", () => {
    const { html } = processContent("line one  \nline two\nline three");
    expect(html).toContain("line one<br />");
    expect(html).toContain("line two\nline three");
  });

  it("renders markdown emphasis inside an HTML body instead of leaking it", () => {
    const { html } = processContent("<p>Read **the guide** now.</p>");
    expect(html).toContain("<strong>the guide</strong>");
    expect(html).not.toContain("**");
  });
});
