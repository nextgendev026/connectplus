import { BRAND_HASHTAG, BRAND_NAME, DEFAULT_OG_IMAGE, SHARE_MEDIUM } from "./brand";

/**
 * The share pipeline.
 *
 * Every share this product hands out has to do three jobs at once, and the old
 * inline implementation did none of them reliably:
 *
 *   1. **Land somewhere that proves the claim.** A shared pick said "Over 2.5 at
 *      61%" and linked to the whole board; the recipient had to hunt for the
 *      pick to check it. The URL a share carries is therefore built from the
 *      thing being shared, not from a fixed landing page.
 *   2. **Be attributable.** Shares carried no `utm_*`, so a link that travelled
 *      through a hundred WhatsApp groups was counted as a direct visit — the one
 *      channel with the most reach was the one that could not be measured.
 *   3. **Fit the platform.** Each network renders a different amount of text and
 *      truncates the rest at a different word; a message composed once and sent
 *      to all of them is either cut mid-sentence or silently dropped. Every
 *      target below declares its own budget and gets its own message.
 *
 * All of it is pure — no React, no `window`, no database — so the behaviour that
 * decides what a stranger sees on another platform is unit-tested.
 */

export type ShareTargetId =
  | "x"
  | "facebook"
  | "linkedin"
  | "whatsapp"
  | "telegram"
  | "email"
  | "copy";

export interface ShareTarget {
  id: ShareTargetId;
  label: string;
  /** `utm_source` for links sent through this channel. */
  source: string;
  /**
   * Characters the platform renders for the text it receives. Conservative by
   * design: being briefly under the limit is invisible, being over it is not —
   * the post gets cut, or (on X) rejected outright.
   */
  textBudget: number;
  /** True for composer-style targets that put the URL in the same field. */
  urlInText: boolean;
  /** Null for `copy`, which has no endpoint — it is the clipboard. */
  endpoint: ((parts: { message: string; url: string; title: string }) => string) | null;
}

/**
 * The channels, in the order the menu shows them.
 *
 * X counts the URL against its 280 characters (t.co shortens it, but the client
 * does not know to what), so its message budget is deliberately small enough to
 * leave room for the link.
 */
export const SHARE_TARGETS: readonly ShareTarget[] = [
  {
    id: "x",
    label: "Post to X",
    source: "x",
    textBudget: 220,
    urlInText: false,
    endpoint: ({ message, url }) =>
      `https://x.com/intent/post?text=${encodeURIComponent(message)}&url=${encodeURIComponent(url)}`,
  },
  {
    id: "facebook",
    label: "Share on Facebook",
    source: "facebook",
    textBudget: 400,
    urlInText: false,
    // Facebook fetches the URL for its card and uses `quote` as the sharer's
    // own words, so the message goes there and must not repeat the link.
    endpoint: ({ message, url }) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(message)}`,
  },
  {
    id: "linkedin",
    label: "Share on LinkedIn",
    source: "linkedin",
    textBudget: 200,
    urlInText: false,
    // LinkedIn builds its own preview from the URL and ignores sharer text; the
    // message is still prepared because the copy path shares the same shape.
    endpoint: ({ url }) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`,
  },
  {
    id: "whatsapp",
    label: "Share on WhatsApp",
    source: "whatsapp",
    textBudget: 600,
    urlInText: true,
    // The most-used channel here by a wide margin: text and link go in one
    // field, because WhatsApp renders whatever is pasted as the message.
    endpoint: ({ message, url }) =>
      `https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`,
  },
  {
    id: "telegram",
    label: "Share on Telegram",
    source: "telegram",
    textBudget: 600,
    urlInText: false,
    endpoint: ({ message, url }) =>
      `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(message)}`,
  },
  {
    id: "email",
    label: "Share by email",
    source: "email",
    textBudget: 900,
    urlInText: true,
    endpoint: ({ message, url, title }) =>
      `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${message}\n\n${url}`)}`,
  },
  {
    id: "copy",
    label: "Copy link",
    source: "copy",
    textBudget: 600,
    urlInText: true,
    endpoint: null,
  },
];

export interface ShareInput {
  /** Absolute or site-relative URL being shared. */
  url: string;
  title: string;
  description?: string | null;
  hashtags?: string[];
  /** Which surface invited the share — `utm_campaign`. */
  campaign?: string;
  /** The specific object — `utm_content`. */
  content?: string;
  /** Origin used to absolute-ise a relative URL outside a browser. */
  origin?: string;
}

export interface PreparedShare {
  target: ShareTarget;
  /** The attributed URL for this channel. */
  url: string;
  /** Message text, already within the channel's budget. */
  message: string;
  /** Endpoint href, or null when the target is the clipboard. */
  href: string | null;
  /** Exactly what lands in the composer or on the clipboard. */
  text: string;
}

/** Sentinel host used to resolve relative URLs without needing a real origin. */
const RELATIVE_ANCHOR = "http://relative.invalid";

/**
 * Add campaign attribution to a URL.
 *
 * Relative URLs stay relative (the sentinel host is stripped back off), because
 * the same helper runs on the server for crawler-facing cards and in the browser
 * for the copy button, and neither should disagree with the other about what the
 * link is.
 *
 * A malformed URL is returned untouched rather than thrown on: a share button
 * that fails because of a URL it did not author is worse than a share without
 * attribution.
 */
export function withAttribution(
  url: string,
  attribution: { source?: string; medium?: string; campaign?: string; content?: string },
  base?: string
): string {
  const raw = (url ?? "").trim();
  // An empty string has nothing to attribute, and anything containing raw
  // whitespace is not a URL this code authored — both are returned untouched so
  // a malformed link degrades to an unattributed link instead of a broken one.
  if (!raw || /\s/.test(raw)) return raw;

  const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("//");
  const anchor = base && base.trim() ? base.trim() : RELATIVE_ANCHOR;

  let parsed: URL;
  try {
    parsed = new URL(raw, isRelative ? anchor : undefined);
  } catch {
    return raw;
  }

  const params: [string, string | undefined][] = [
    ["utm_source", attribution.source],
    ["utm_medium", attribution.medium ?? SHARE_MEDIUM],
    ["utm_campaign", attribution.campaign],
    ["utm_content", attribution.content],
  ];
  for (const [key, value] of params) {
    const trimmed = (value ?? "").trim();
    if (trimmed) parsed.searchParams.set(key, trimmed);
  }

  // A relative URL resolved against the placeholder host must come back
  // relative: an absolute URL carrying that host would be worse than no URL at
  // all. When a real origin was supplied, the absolute form is the point.
  if (isRelative && anchor === RELATIVE_ANCHOR) {
    const absolute = parsed.href;
    return absolute.startsWith(RELATIVE_ANCHOR) ? absolute.slice(RELATIVE_ANCHOR.length) : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  return parsed.href;
}

/**
 * Hashtags, sanitised.
 *
 * Space, punctuation or an emoji inside a hashtag makes the platform cut the tag
 * at that character, so the brand tag can silently become "#connectPlus".
 * Deduplicated case-insensitively, and the brand tag is always present because
 * on a platform that strips the link it is the only thing that identifies where
 * the share came from.
 */
export function normalizeHashtags(input: readonly string[] | undefined, max = 3): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const cleaned = raw
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}_]/gu, "")
      .slice(0, 24);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  for (const tag of input ?? []) push(tag);
  // The brand tag goes first if the caller did not already lead with it — a list
  // that has to drop tags keeps this one.
  if (!seen.has(BRAND_HASHTAG.toLowerCase())) out.unshift(BRAND_HASHTAG);
  if (out.length > max) {
    // Keep the brand tag even when trimming.
    const rest = out.filter((t) => t.toLowerCase() !== BRAND_HASHTAG.toLowerCase());
    return [out.find((t) => t.toLowerCase() === BRAND_HASHTAG.toLowerCase()) ?? BRAND_HASHTAG, ...rest].slice(0, max);
  }
  return out;
}

/** Cut at a word boundary, never mid-word and never leaving a stray space. */
export function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  if (max <= 1) return "…".slice(0, Math.max(max, 0));
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.4 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd().replace(/[.,;:!?—–-]$/, "")}…`;
}

/**
 * The message that travels with the link.
 *
 * Order matters and is deliberate: the claim first (what a reader decides on),
 * then the supporting sentence, then the hashtags. The URL is never part of this
 * string — the targets that put it in the same field append it — so a message can
 * be trimmed to fit without ever breaking the link.
 */
export function buildShareMessage({
  title,
  description,
  hashtags,
  siteName = BRAND_NAME,
  maxLength = 280,
}: {
  title: string;
  description?: string | null;
  hashtags?: readonly string[];
  siteName?: string;
  maxLength?: number;
}): string {
  const headline = clampText(title ?? "", Math.max(maxLength, 40)) || `${siteName} on ${BRAND_NAME}`;
  const detail = (description ?? "").replace(/\s+/g, " ").trim();
  const tags = normalizeHashtags(hashtags);
  const tagLine = tags.map((t) => `#${t}`).join(" ");

  const stem = (() => {
    if (!detail) return headline;
    const joined = `${headline} — ${detail}`;
    const room = maxLength - (tagLine ? tagLine.length + 1 : 0);
    // Only pay for the description while it leaves the headline intact: a card
    // whose opening words are eaten to make room for a second sentence reads
    // worse than one that simply stops after the claim.
    if (joined.length <= room) return joined;
    if (room - headline.length - 3 > 40) return `${headline} — ${clampText(detail, room - headline.length - 3)}`;
    return headline;
  })();

  const trimmedStem = clampText(stem, Math.max(maxLength - (tagLine ? tagLine.length + 1 : 0), 0));

  if (!tagLine) return trimmedStem;

  const withTags = `${trimmedStem} ${tagLine}`;
  if (withTags.length <= maxLength) return withTags;

  // Cannot fit them all: keep the leading tags that fit rather than dropping
  // attribution entirely.
  const kept: string[] = [];
  let used = trimmedStem.length;
  for (const tag of tags) {
    const cost = tag.length + 2; // " #tag"
    if (used + cost > maxLength) break;
    kept.push(`#${tag}`);
    used += cost;
  }
  return kept.length > 0 ? `${trimmedStem} ${kept.join(" ")}` : trimmedStem;
}

/**
 * Absolute URL for the preview image, falling back to the generated card.
 *
 * Used by the share menu's own preview panel, which should show the picture the
 * recipient will actually see — the emoji placeholder it used to render there
 * made an article with no cover look like a chat message.
 */
export function shareImage(image: string | null | undefined, origin?: string): string {
  const raw = (image ?? "").trim() || DEFAULT_OG_IMAGE;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return raw;
  const base = (origin ?? "").replace(/\/+$/, "");
  return base ? `${base}${raw.startsWith("/") ? raw : `/${raw}`}` : raw;
}

/** Everything each channel needs: attributed URL, fitted message, endpoint. */
export function createShareTargets(input: ShareInput): PreparedShare[] {
  const origin =
    input.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");

  let absolute = input.url?.trim() ?? "";
  if (absolute && !/^[a-z][a-z0-9+.-]*:/i.test(absolute) && !absolute.startsWith("//") && origin) {
    absolute = `${origin.replace(/\/+$/, "")}${absolute.startsWith("/") ? absolute : `/${absolute}`}`;
  }

  const title = clampText(input.title ?? "", 120) || BRAND_NAME;

  return SHARE_TARGETS.map((target) => {
    const url = withAttribution(absolute, {
      source: target.source,
      medium: SHARE_MEDIUM,
      campaign: input.campaign,
      content: input.content,
    });
    const message = buildShareMessage({
      title,
      description: input.description,
      hashtags: input.hashtags,
      maxLength: target.textBudget,
    });
    const text = target.urlInText && url ? `${message} ${url}`.trim() : message;
    return {
      target,
      url,
      message,
      href: target.endpoint ? target.endpoint({ message, url, title }) : null,
      text,
    };
  });
}

/** The canonical (unattributed-but-origin-resolved) URL for the copy path. */
export function canonicalShareUrl(input: ShareInput): string {
  const origin =
    input.origin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const raw = input.url?.trim() ?? "";
  if (!raw) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return raw;
  if (!origin) return raw;
  return `${origin.replace(/\/+$/, "")}${raw.startsWith("/") ? raw : `/${raw}`}`;
}
