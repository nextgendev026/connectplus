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
  "iframe",
]);

const SKIP_TAGS = new Set([
  "script", "style", "template", "noscript", "iframe", "object", "embed", "link", "meta", "svg",
]);

/** Tags we render but with their inner content preserved (e.g. keep text of code). */
const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "iframe"]);

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
export function sanitizeHtml(html: string): string {
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
      result += escapeHtml(textPart);
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

/**
 * Process article content into clean HTML.
 * - If the content contains HTML tags, it sanitizes and returns it directly.
 * - Otherwise it treats the text as light markdown/plain paragraphs.
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

  let html: string;
  if (looksLikeHtml) {
    html = sanitizeHtml(trimmed);
  } else {
    // Plain text / light markdown -> paragraph blocks
    const blocks = trimmed.split(/\n{2,}/);
    html = blocks
      .map((block) => {
        const b = block.trim();
        if (!b) return "";
        const header = b.match(/^(#{1,6})\s+(.+)$/);
        if (header) {
          const level = (header[1] ?? "#").length;
          return `<h${level}>${inlineMarkdown(header[2] ?? "")}</h${level}>`;
        }
        if (/^[-*]\s+/.test(b)) {
          const items = b
            .split(/\n/)
            .filter((l) => /^[-*]\s+/.test(l.trim()))
            .map((l) => `<li>${inlineMarkdown(l.trim().replace(/^[-*]\s+/, ""))}</li>`)
            .join("");
          return `<ul>${items}</ul>`;
        }
        if (/^\d+\.\s+/.test(b)) {
          const items = b
            .split(/\n/)
            .filter((l) => /^\d+\.\s+/.test(l.trim()))
            .map((l) => `<li>${inlineMarkdown(l.trim().replace(/^\d+\.\s+/, ""))}</li>`)
            .join("");
          return `<ol>${items}</ol>`;
        }
        if (/^>\s+/.test(b)) {
          return `<blockquote>${inlineMarkdown(b.replace(/^>\s+/, ""))}</blockquote>`;
        }
        return `<p>${inlineMarkdown(b)}</p>`;
      })
      .filter(Boolean)
      .join("\n\n");
  }

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
