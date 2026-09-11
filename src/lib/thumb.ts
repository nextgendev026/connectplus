/**
 * Post cover resolution. When an article has a real cover image we use it;
 * otherwise we return a generated branded thumbnail so that every published
 * article — including RSS imports that lack images — still renders a
 * relevant visual instead of an empty gradient block.
 *
 * Generated covers use the query-free /api/thumb/<code> form (base64url of
 * the thumbnail parts). Local optimizer URLs carrying a "?" are rejected by
 * the Next.js image optimizer, which is exactly why generated covers used to
 * render only where raw <img> tags were used while uploaded covers worked
 * everywhere. The path form flows through next/image, the CDN, and the PWA
 * image cache like any other cover.
 */

export interface ThumbOptions {
  title?: string;
  category?: string | null;
  author?: string | null;
  seed?: string;
  /** Force generation even when coverImage is present. */
  force?: boolean;
}

function clampText(value: string | null | undefined, max: number): string {
  if (!value) return "";
  const v = value.replace(/\s+/g, " ").trim();
  return v.length > max ? `${v.slice(0, max - 1).trimEnd()}…` : v;
}

/** Universal base64url (coverSrc runs on both server and client components,
 *  where Node's Buffer does not exist). Byte-identical output on both sides
 *  so SSR and client renders mint the same cache-friendly URL. */
function toB64Url(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(json, "utf-8").toString("base64") : btoa(bin);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeCode(opts: Required<Pick<ThumbOptions, "title" | "seed">> & ThumbOptions): string {
  const payload = {
    t: clampText(opts.title, 120),
    c: clampText(opts.category, 32),
    a: clampText(opts.author, 32),
    s: String(opts.seed ?? opts.title ?? "connectplus"),
  };
  return toB64Url(JSON.stringify(payload));
}

/**
 * Returns the cover URL for a post. Prefer the real image; only synthesize a
 * thumbnail when there is none (or `force` is set).
 */
export function coverSrc(
  coverImage: string | null | undefined,
  opts: ThumbOptions = {}
): string {
  if (!opts.force && coverImage) return coverImage;
  return `/api/thumb/${encodeCode({ title: opts.title ?? "", seed: opts.seed ?? "", ...opts })}`;
}

/** Convenience when you only have the parts. */
export function thumbUrl(opts: ThumbOptions): string {
  return coverSrc(null, opts);
}

/**
 * Cover URL for a stored post, resolved by id instead of by value.
 *
 * WHY: several covers are stored as base64 `data:` URIs (multi-megabyte rows —
 * one is 4 MB). Selecting that column pulled megabytes through Postgres,
 * Prisma, Redis and finally the HTML/RSC payload on EVERY feed render, and
 * `og:image` pointed at `https://site/data:image/jpeg;base64,…`, which no
 * social crawler will fetch — that is why link previews failed to attach.
 *
 * `/api/thumb/post/<id>` streams the real cover (or paints the branded
 * fallback when there is none) with long-lived cache headers, so feeds, OG
 * tags, social cards and the image optimizer all deal with a short URL.
 */
export function postCoverSrc(postId: string): string {
  return `/api/thumb/post/${postId}`;
}

/** True for inline base64/percent-encoded image payloads stored in the DB. */
export function isInlineImage(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("data:image/");
}
