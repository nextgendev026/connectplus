/**
 * Content processing for article bodies.
 *
 * Post content is heterogeneous:
 *  - Composer posts are written as plain text / light markdown.
 *  - RSS-imported posts store the raw HTML from the feed (content:encoded).
 *
 * `processContent` normalizes either into clean, safe, styled HTML so every
 * article renders beautiful rich text instead of leaking raw markup. The
 * output is sanitized (no scripts/events) before it is injected into the DOM.
 */

export interface ProcessedContent {
  html: string;
  text: string;
  hasImages: boolean;
  wordCount: number;
}

/** Allowed tags and the attributes we keep on them. */
const ALLOWED_TAGS = new Set([
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "strong", "b", "em", "i", "u", "s", "strike",
  "blockquote", "code", "pre",
  "a", "img",
  "table", "thead", "tbody", "tr", "th", "td",
  "figure", "figcaption", "span", "div",
  // NOTE: no `iframe`. It used to be listed here *and* in SKIP_TAGS, which read
  // as "strip it" but did not: the pre-strip below only removes paired
  // (`<iframe …></iframe>`) and self-closed (`<iframe …/>`) forms, so a bare
  // `<iframe src="https://attacker">` fell through to this allow-list and was
  // emitted into the article body. Post bodies are publisher-controlled (RSS
  // `content:encoded`), so that was a stored-XSS and clickjacking vector.
]);

const SKIP_TAGS = new Set([
  "script", "style", "template", "noscript", "iframe", "object", "embed", "link", "meta", "svg",
]);

/** Tags we render but with their inner content preserved (e.g. keep text of code). */
const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeAttr(name: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const lower = name.toLowerCase();
  if (lower === "href" || lower === "src") {
    if (/^https?:\/\//i.test(v) || v.startsWith("/") || v.startsWith("#") || v.startsWith("mailto:")) {
      return v;
    }
    return null;
  }
  return v;
}

/**
 * Convert raw HTML (from RSS) into a safe HTML string via an allow-list,
 * preserving useful structure (headings, lists, quotes, links, images).
 */
export function sanitizeHtml(html: string, inlineText = false): string {
  // Pre-strip unsafe blocks (and their entire content): comments, and any
  // element in SKIP_TAGS, both self-closing and paired, so script/style bodies
  // never leak back into the output as text.
  const skipRe = new RegExp(
    `(<!--[\\s\\S]*?-->|\\s*<\\s*(${Array.from(SKIP_TAGS).join("|")})[^>]*?>[\\s\\S]*?</\\s*\\2\\s*>|\\s*<\\s*(${Array.from(SKIP_TAGS).join("|")})[^>]*?/\\s*>)`,
    "gi"
  );
  html = html.replace(skipRe, "");

  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let result = "";
  let m: RegExpExecArray | null;
  let textPart = "";
  const pushText = () => {
    if (textPart) {
      // Bodies that mix HTML with markdown emphasis (cross-posted feeds, AI
      // summaries) would otherwise leak literal ** markers onto the page, so
      // when the caller spotted those markers the text runs get inline
      // markdown too.
      result += inlineText ? inlineMarkdown(textPart) : escapeHtml(textPart);
      textPart = "";
    }
  };

  while ((m = re.exec(html)) !== null) {
    const [, close, rawTag, rawAttrs, selfClose, text] = m;
    if (text !== undefined) {
      textPart += text;
      continue;
    }
    pushText();
    const tag = (rawTag ?? "").toLowerCase();
    if (SKIP_TAGS.has(tag)) {
      // Drop the element entirely (including its children): skip to matching close
      // isn't strictly needed for these (they tend not to nest), so just omit.
      continue;
    }
    if (close) {
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) {
        // For block structural tags, normalize to the canonical name.
        result += `</${canonicalTag(tag)}>`;
      }
      continue;
    }
    if (!ALLOWED_TAGS.has(tag)) {
      continue;
    }
    const canonical = canonicalTag(tag);
    // Build allowed attributes
    const attrs: string[] = [];
    const attrRe = /([a-zA-Z-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(rawAttrs ?? "")) !== null) {
      const name = (am[1] ?? "").toLowerCase();
      const value = am[2] ?? am[3] ?? am[4] ?? "";
      if (name === "class" || name === "style" || name.startsWith("on")) continue;
      const safe = safeAttr(name, value);
      if (safe !== null) {
        attrs.push(`${name}="${escapeHtml(safe)}"`);
      }
    }
    const self = selfClose || VOID_TAGS.has(canonical) ? " /" : "";
    result += `<${canonical}${attrs.length ? " " + attrs.join(" ") : ""}${self}>`;
  }
  pushText();
  return result;
}

function canonicalTag(tag: string): string {
  switch (tag) {
    case "b":
      return "strong";
    case "i":
      return "em";
    case "strike":
      return "s";
    default:
      return tag;
  }
}

/** Convert a block of inline markdown-ish emphasis/bold/link/code into HTML. */
function inlineMarkdown(text: string): string {
  const esc = escapeHtml(text);
  let out = esc;
  // code `x`
  out = out.replace(/`([^`]+)`/g, (_m, c: string) => `<code>${c}</code>`);
  // bold **x** or __x__
  out = out.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a: string, b: string) => `<strong>${a ?? b}</strong>`);
  // italic *x* or _x_
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, (_m, pre: string, c: string) => `${pre}<em>${c}</em>`);
  // links [text](url)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t: string, u: string) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  return out;
}

/* ------------------------------------------------------------------ */
/* Light markdown (composer + AI writer bodies)                        */
/* ------------------------------------------------------------------ */

const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_THEMATIC_BREAK = /^ {0,3}(?:[-*_]\s*){3,}$/;
const RE_BULLET = /^ {0,3}[-*+]\s+(.*)$/;
const RE_ORDERED = /^ {0,3}\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;
const RE_FENCE = /^ {0,3}(?:```|~~~)\s*[\w+-]*\s*$/;

/**
 * Inline-render a run of source lines, honouring markdown hard breaks (two
 * trailing spaces or a backslash). A bare newline is a soft wrap, so it stays
 * collapsed whitespace exactly like markdown says it should.
 */
function renderInlineLines(lines: string[]): string {
  return lines
    .map((line) => {
      const hardBreak = /(?: {2,}|\\)$/.test(line);
      const bare = line.replace(/(?: {2,}|\\)$/, "");
      return `${inlineMarkdown(bare)}${hardBreak ? "<br />" : ""}`;
    })
    .join("\n");
}

/**
 * Split a single source line on headings the writer glued onto the end of a
 * paragraph ("… get wrong. ## The momentum behind Adopts"). Returns the parts
 * in order, each tagged with its heading level (0 = ordinary text), or null
 * when the line has no such marker. Only two-or-more hashes count: a lone `#`
 * is a hashtag, not a heading.
 */
function splitInlineHeadings(line: string): { level: number; text: string }[] | null {
  const marker = /\s(#{2,6})\s+(?=\S)/g;
  if (!marker.test(line)) return null;
  const parts: { level: number; text: string }[] = [];
  let last = 0;
  marker.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(line)) !== null) {
    parts.push({ level: 0, text: line.slice(last, m.index) });
    parts.push({ level: (m[1] ?? "##").length, text: "" });
    last = m.index + m[0].length;
  }
  parts.push({ level: 0, text: line.slice(last) });
  // Fold each heading's following text into the heading itself.
  const folded: { level: number; text: string }[] = [];
  for (const part of parts) {
    const previous = folded[folded.length - 1];
    if (previous && previous.level > 0 && previous.text === "") {
      previous.text = part.text;
    } else {
      folded.push({ ...part });
    }
  }
  return folded.filter((part) => part.text.trim() !== "");
}

/**
 * Render a light-markdown body into block HTML.
 *
 * Deliberately line-based instead of split-on-blank-lines. The AI writer emits
 * `### Heading  ` followed by its paragraph, and lists that share a run with
 * the text around them; treating each blank-line chunk as one opaque block left
 * those markers visible on the published page ("### Introduction" and
 * "- **FinTech hubs:**" as literal text). Blocks open and close as the lines
 * call for them, so a heading or bullet mid-run becomes real markup.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: string[] | null = null;

  const endParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p>${renderInlineLines(paragraph)}</p>`);
    paragraph = [];
  };
  const endQuote = () => {
    if (quote.length === 0) return;
    blocks.push(`<blockquote>${renderInlineLines(quote)}</blockquote>`);
    quote = [];
  };
  const endList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(`<${tag}>${list.items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
    list = null;
  };
  const endAll = () => {
    endParagraph();
    endQuote();
    endList();
  };

  const flushFence = () => {
    if (!fence) return;
    blocks.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
    fence = null;
  };

  for (const line of lines) {
    // Inside a fenced block nothing is markup until the closing fence.
    if (fence) {
      if (RE_FENCE.test(line)) flushFence();
      else fence.push(line);
      continue;
    }

    if (line.trim() === "") {
      endAll();
      continue;
    }

    if (RE_FENCE.test(line)) {
      endAll();
      fence = [];
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      endAll();
      blocks.push(`<h${level}>${inlineMarkdown(heading[2] ?? "")}</h${level}>`);
      continue;
    }

    // Before the list rules: `- - -` is a rule, not a bullet.
    if (RE_THEMATIC_BREAK.test(line)) {
      endAll();
      blocks.push("<hr />");
      continue;
    }

    const bullet = RE_BULLET.exec(line);
    const ordered = bullet ? null : RE_ORDERED.exec(line);
    if (bullet || ordered) {
      endParagraph();
      endQuote();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) endList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push(inlineMarkdown((bullet ? bullet[1] : ordered?.[1]) ?? ""));
      continue;
    }

    const quoted = RE_QUOTE.exec(line);
    if (quoted) {
      endParagraph();
      endList();
      quote.push(quoted[1] ?? "");
      continue;
    }

    // A plain line starts a new paragraph. Any open quote/list is closed here
    // so blocks keep their source order instead of flushing out of sequence.
    endQuote();
    endList();

    const mixed = splitInlineHeadings(line);
    if (mixed) {
      for (const part of mixed) {
        if (part.level > 0) {
          endParagraph();
          blocks.push(`<h${part.level}>${inlineMarkdown(part.text.trim())}</h${part.level}>`);
        } else {
          paragraph.push(part.text.trim());
        }
      }
      continue;
    }

    paragraph.push(line);
  }

  // An unterminated fence still renders as code rather than vanishing.
  flushFence();
  endAll();

  return blocks.join("\n\n");
}

/**
 * Process article content into clean HTML.
 * - Bodies containing HTML tags are sanitized (RSS `content:encoded`).
 * - Everything else is rendered as light markdown (composer + AI writer).
 * Either way the result is safe to inject and already styled by the prose CSS,
 * so a published article never shows its raw source.
 * Extracts a plain-text version and other stats in the same pass.
 */
export function processContent(content: string): ProcessedContent {
  if (!content) {
    return { html: "", text: "", hasImages: false, wordCount: 0 };
  }

  const trimmed = content.trim();

  // Detect HTML: RSS bodies are HTML. Composer bodies are plain text that may
  // contain accidental < or > for math ("1 < 2"); only treat as HTML when we
  // actually see a known tag.
  const looksLikeHtml = /<(p|div|h[1-6]|ul|ol|blockquote|img|figure|table|pre|br|strong|em|a|span)[\s>]/i.test(trimmed);

  // HTML bodies can still carry markdown emphasis (cross-posted feeds, AI
  // summaries): those text runs get inline markdown so the markers never show.
  const htmlHasMarkdown = /\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\//.test(trimmed);

  const html = looksLikeHtml ? sanitizeHtml(trimmed, htmlHasMarkdown) : markdownToHtml(trimmed);

  const text = stripText(html);
  return {
    html,
    text,
    hasImages: /<img[\s>]/i.test(html),
    wordCount: text.split(/\s+/).filter(Boolean).length,
  };
}

function stripText(html: string): string {
  const withoutTags = html.replace(/<[^>]+>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim();
}

/** Short plain-text excerpt for cards/feed (no HTML leaking). */
export function excerptFromHtml(html: string, maxLength = 160): string {
  const text = stripText(html);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trimEnd()}…`;
}

/**
 * Plain-text excerpt from a stored excerpt or body that may be markdown or
 * HTML. Feed cards, meta descriptions and share text render this, and the AI
 * writer stores markdown excerpts ("## Discover Kenya's Top Tourism Attraction
 * Sites  \n\nKenya isn't just…", "- **Route groups** …") which otherwise reach
 * the card as literal markers.
 */
export function plainExcerpt(source: string | null | undefined, maxLength = 200): string {
  const raw = (source ?? "").trim();
  if (!raw) return "";
  return excerptFromHtml(processContent(raw).html, maxLength);
}
