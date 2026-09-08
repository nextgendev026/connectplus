/**
 * Post cover resolution. When an article has a real cover image we use it;
 * otherwise we return a generated branded thumbnail (`/api/thumb`) so that
 * every published article — including RSS imports that lack images — still
 * renders a relevant visual instead of an empty gradient block.
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

/**
 * Returns the cover URL for a post. Prefer the real image; only synthesize a
 * thumbnail when there is none (or `force` is set).
 */
export function coverSrc(
  coverImage: string | null | undefined,
  opts: ThumbOptions = {}
): string {
  if (!opts.force && coverImage) return coverImage;

  const params = new URLSearchParams();
  const title = clampText(opts.title, 120);
  if (title) params.set("t", title);
  const category = clampText(opts.category, 32);
  if (category) params.set("c", category);
  const author = clampText(opts.author, 32);
  if (author) params.set("a", author);
  // The slug/id pins the color way; deterministic but nicely varied.
  const seedForHash = opts.seed ?? (title || "connectplus");
  params.set("s", String(seedForHash));

  return `/api/thumb?${params.toString()}`;
}

/** Convenience when you only have the parts. */
export function thumbUrl(opts: ThumbOptions): string {
  return coverSrc(null, opts);
}