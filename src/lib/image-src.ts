/**
 * Image URL resolution with NO runtime dependencies.
 *
 * Split from `thumb.ts` because these run inside client components (feed cards,
 * the hero slideshow), and `thumb.ts` is imported by the server thumbnail route.
 * This module may only ever import nothing.
 *
 * The problem it solves: only images uploaded *after* the optimizer shipped are
 * stored optimised. RSS-imported photos and every cover uploaded before it are
 * still full-size, so the feed was shipping multi-megabyte JPEGs. Routing those
 * through `/api/optimize` shrinks them on demand, and the ones that are already
 * perfect (generated thumbnails, `data:` URIs) are left alone.
 */

export type OptimizePresetName = "cover" | "thumbnail" | "avatar" | "og" | "story" | "adminThumb";

export interface OptimizeOptions {
  preset?: OptimizePresetName;
  /** Target width in px; overrides the preset's bound when set. */
  width?: number;
  /** Target height in px; overrides the preset's bound when set. */
  height?: number;
  /** 1–100. Left to the preset when omitted. */
  quality?: number;
}

/** Paths we must never re-optimize: already generated, already optimized, or inline. */
function isPassthrough(url: string): boolean {
  return (
    url.startsWith("/api/thumb/") ||
    url.startsWith("/api/optimize") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  );
}

/** True when the optimizer can meaningfully act on this URL. */
export function isOptimizable(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isPassthrough(url)) return false;
  // Root-relative (our own uploads) or an explicit http(s) origin.
  return url.startsWith("/") || /^https?:\/\//i.test(url);
}

/**
 * True when a source can be asked for a specific pixel width directly.
 *
 * Only the *stored-cover* route is width-addressable (`/api/thumb/post/<id>`,
 * which streams a real image out of Postgres or the publisher's host). It
 * accepts `?w=` and resizes before answering.
 *
 * The generated branded thumbnail — `/api/thumb/<base64 code>` — is an SVG.
 * Two reasons it is excluded: it has nothing to gain from a pixel width, and
 * its whole design depends on being a *query-free* URL, which is what lets it
 * sail through the Next.js image optimizer and the CDN cache. Appending a
 * query would quietly undo that.
 */
export function isWidthAddressable(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("/api/thumb/post/");
}

/** Ask the thumbnail route for one specific width. */
export function thumbWidthSrc(url: string, width: number): string {
  if (!isWidthAddressable(url)) return url;
  const w = Math.min(Math.max(Math.round(width), 64), 1600);
  return `${url}${url.includes("?") ? "&" : "?"}w=${w}`;
}

/**
 * The URL an `<img>`/`<picture>` should point at.
 *
 * Returns "" for a missing source so the caller can decide on a fallback rather
 * than rendering a broken image. Generated thumbnails and `data:` URIs pass
 * through untouched — the optimizer has nothing to add and a round trip would
 * only cost latency. A width-addressable cover is asked for its width directly
 * rather than handed to the optimizer, because it arrives from our own route,
 * which is already the resize step.
 */
export function optimizedImageSrc(
  url: string | null | undefined,
  { preset = "cover", width, height, quality }: OptimizeOptions = {}
): string {
  if (!url || !url.trim()) return "";
  if (isWidthAddressable(url)) return width ? thumbWidthSrc(url, width) : url;
  if (!isOptimizable(url)) return url;

  const params = new URLSearchParams({ url, preset });
  if (width) params.set("w", String(Math.round(width)));
  if (height) params.set("h", String(Math.round(height)));
  if (quality) params.set("q", String(Math.round(quality)));
  return `/api/optimize?${params.toString()}`;
}

/**
 * The widths each preset should offer a browser, smallest first.
 *
 * Before this, every caller that did not name a `width` got one URL at the
 * preset's maximum — so a 360px phone downloaded the same 1200px cover art as a
 * desktop, and the median page shipped roughly four times the image bytes it
 * needed. That is the single largest cost on the mobile build, because covers
 * are the heaviest asset on every feed, article and card.
 *
 * The stops are chosen against the app's own layout: a feed card is full width
 * on a phone, half on a tablet at 640px, and one of two or three columns on a
 * desktop at 1024px and beyond.
 */
const PRESET_WIDTHS: Record<OptimizePresetName, number[]> = {
  cover: [400, 640, 960, 1280],
  thumbnail: [160, 240, 320, 480],
  avatar: [48, 96, 160],
  og: [],
  story: [],
  adminThumb: [96, 160],
};

/**
 * The default `sizes` attribute per preset.
 *
 * Without it a browser assumes the image is viewport-wide and picks the largest
 * candidate in the srcset — which is the bug this whole change exists to fix,
 * in a subtler form. Each string mirrors how the preset is actually laid out.
 */
const PRESET_SIZES: Record<OptimizePresetName, string> = {
  cover: "(min-width: 1024px) 720px, (min-width: 640px) 50vw, 100vw",
  thumbnail: "(min-width: 1024px) 280px, (min-width: 640px) 45vw, 100vw",
  avatar: "48px",
  og: "100vw",
  story: "100vw",
  adminThumb: "96px",
};

/** The candidate widths for a preset, or `[]` when one size is enough. */
export function widthsForPreset(preset: OptimizePresetName): number[] {
  return PRESET_WIDTHS[preset] ?? [];
}

/** The default `sizes` for a preset, so a caller never has to think about it. */
export function sizesForPreset(preset: OptimizePresetName): string {
  return PRESET_SIZES[preset] ?? "100vw";
}

/**
 * A `srcset` for a cover, or `""` when there is nothing to choose from.
 *
 * Two kinds of source can offer real alternatives, and they are asked in
 * different ways:
 *
 *   • a **stored cover** (`/api/thumb/post/<id>`) takes `?w=` — the route
 *     resizes before answering, so each candidate really is a smaller image;
 *   • anything else **optimizable** goes through `/api/optimize`, which
 *     negotiates format and resizes on demand.
 *
 * Everything else returns empty: the generated `data:`-style thumbnails and
 * inline SVGs would produce four identical entries, which only makes the
 * browser work harder for the same bytes. Callers omit the attribute when this
 * returns empty rather than rendering `srcset=""`, which is invalid and can
 * defeat the `src` fallback.
 */
export function responsiveSrcSet(
  url: string | null | undefined,
  widths: number[],
  opts: OptimizeOptions = {}
): string {
  if (!url || !url.trim()) return "";
  const unique = [...new Set(widths.filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b);
  if (unique.length < 2) return "";
  if (isWidthAddressable(url)) {
    return unique.map((w) => `${thumbWidthSrc(url, w)} ${w}w`).join(", ");
  }
  if (!isOptimizable(url)) return "";
  return unique.map((w) => `${optimizedImageSrc(url, { ...opts, width: w })} ${w}w`).join(", ");
}

/**
 * A comparable key for "which request was this?".
 *
 * The browser reports a failed image as `img.currentSrc`, which is always an
 * *absolute* URL, while this module works with root-relative ones. Comparing the
 * two as strings therefore never matches: a genuine failure of
 * `/api/thumb/post/x` was recorded as `https://host/api/thumb/post/x` and then
 * not recognised as that same request at all.
 *
 * The key is the path and query, which is identical across both spellings — and,
 * crucially, *different* for a `srcset` candidate (`…/x?w=960`) than for the
 * `src` it was chosen from (`…/x`). Collapsing those two was the bug: a single
 * failed candidate was recorded against the `src` it never came from, so the
 * component decided its only source had died and unmounted the image.
 *
 * The origin is deliberately not part of the key. Two hosts sharing a path is
 * possible in principle but harmless here — the worst case is skipping a
 * fallback that would have worked, never a loop.
 */
export function requestKey(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url, "http://local.invalid");
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Which URL an `<img>` should actually request, given what has already failed.
 *
 * The chain is derived → original → terminal → nothing. It exists because a
 * broken `<img>` is silent: when the derived URL fails, the reader sees a hole
 * and nothing anywhere says why. The failure this was written for is specific
 * and common — an image optimizer running out of quota answers `402` with an
 * HTML body instead of a picture, and every affected cover disappears at once
 * while the original file, one rewrite away, is perfectly intact.
 *
 * `terminal` is the caller's designated last resort — for a feed cover, the
 * branded thumbnail that already exists for stories published without a
 * picture. Without it a cover whose every derived form failed had nowhere to
 * land but `null`, and `null` is a blank card: an `<img>` that renders nothing
 * at all and reports nothing. With it the worst case is a less specific image,
 * which is strictly better than a hole.
 *
 * Pure and exported so the *order* can be asserted. Each half is easy to get
 * wrong in a way no single render reveals: retrying the same URL forever (a
 * request loop), or skipping a candidate and giving up (a hole that did not have
 * to be one).
 *
 * Entries that repeat an earlier one are skipped, because requesting exactly
 * what just failed would look like a fallback while doing nothing.
 */
export function fallbackSource(
  resolved: string,
  original: string | null | undefined,
  failed: readonly string[],
  terminal?: string | null
): string {
  if (!resolved) return "";
  const dead = new Set(failed.map(requestKey));
  for (const candidate of [resolved, original, terminal]) {
    if (!candidate) continue;
    if (!dead.has(requestKey(candidate))) return candidate;
  }
  return "";
}

/**
 * The `type` attribute for a `<source>` element, guessed from the extension.
 *
 * Used by the feed and the picture element so a WebP cover is not advertised as
 * `image/jpeg` — a mismatch some consumers act on.
 */
export function imageMimeFromUrl(url: string | null | undefined): string {
  const ext = (url ?? "").split(/[?#]/)[0]!.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "image/jpeg";
  }
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

/** Deterministic brand-adjacent hue so an author keeps the same colour everywhere. */
function hueOf(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

/**
 * The avatar to render for a user.
 *
 * Falls back to an inline SVG of the author's initials rather than a
 * third-party placeholder service (the feed used `i.pravatar.cc`, which means a
 * reader's browser made a request to a stranger's server — and every avatarless
 * writer silently depended on that server being up).
 */
export function avatarSrc(avatar: string | null | undefined, name: string | null | undefined): string {
  const label = (name ?? "").trim() || "Reader";
  if (avatar && avatar.trim()) return avatar;
  const hue = hueOf(label);
  const initials = initialsOf(label);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 70% 55%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 40) % 360} 70% 40%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="96" height="96" rx="48" fill="url(#g)"/>` +
    `<text x="48" y="50" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="system-ui,Segoe UI,sans-serif" font-size="38" font-weight="700" fill="#fff">` +
    `${initials}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
