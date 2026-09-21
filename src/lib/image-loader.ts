import type { ImageLoaderProps } from "next/image";

/**
 * The loader `next/image` uses, in place of Vercel's optimizer.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * With no `loader` configured, every `<Image>` on the site resolves to Vercel's
 * `/_next/image` endpoint, which resizes and re-encodes on demand and is metered
 * against a separate "Image Optimization" allowance. That allowance is what
 * exhausted, and it is separate from function invocations and bandwidth — so
 * "the free tier is used up" points here first, because a feed of RSS covers from
 * arbitrary publisher domains, each requested at four widths, is exactly the
 * traffic shape that consumes it fastest.
 *
 * ── The decision that matters, and why it is not the obvious one ─────────────
 *
 * The obvious fix is to point the loader at our own optimizer, `/api/optimize`,
 * which already exists and already runs sharp. That is the wrong default here:
 * it would move the cost from Vercel's *image* meter to Vercel's *function*
 * meter, which is a different line on the same exhausted bill. A fix that
 * relocates a bill rather than removing it is not a fix.
 *
 * So the default is **pass-through**, in this order:
 *
 *   1. Cloudflare Image Resizing, when `NEXT_PUBLIC_IMAGE_RESIZE_ORIGIN` is set
 *      — width-aware, `format=auto`, so the resize happens at the edge and costs
 *      no Vercel compute at all. This is the intended long-term path and the one
 *      the request asked for.
 *   2. Otherwise, the source URL unchanged. The browser fetches the origin image
 *      directly and the existing edge worker caches it. Zero Vercel work.
 *
 * Pass-through is a real trade — the browser gets the original bytes, so a
 * full-size publisher JPEG is served to a phone. Two things make that acceptable
 * rather than merely cheap: our own uploads are already resized and re-encoded at
 * upload time by `/api/upload`, and `/api/thumb/<id>` is already
 * width-addressable, so the heaviest assets on the site are sized before this
 * loader is ever consulted. What remains is third-party covers.
 *
 * ── Not Convex ──────────────────────────────────────────────────────────────
 *
 * Convex cannot do this and no amount of wiring will make it: it is a reactive
 * database, and while it has file storage it exposes no resize or transcode
 * operation. There is nothing to call that returns a 400px WebP. Convex's role on
 * this platform is view and ad counters (`convex/views.ts`, `convex/ads.ts`), and
 * that is the right role for it.
 *
 * ── Cloudflare's own caveat, stated plainly ─────────────────────────────────
 *
 * `/cdn-cgi/image/` requires Cloudflare **Image Resizing** (a paid add-on) or
 * Images. On a free Cloudflare plan the path returns an error rather than a
 * resized image, so this loader is written to fall back to pass-through when the
 * origin is unset — the site keeps working, it just serves originals. Setting the
 * env var on a plan without the entitlement degrades images rather than breaking
 * them, which is the failure mode worth choosing.
 *
 * Must stay dependency-free like `image-src`: it is bundled into client
 * components, and every import it pulls in ships to the browser.
 */

/** Cloudflare zone origin for Image Resizing, e.g. `https://cdn.example.com`. */
const RESIZE_ORIGIN = (process.env.NEXT_PUBLIC_IMAGE_RESIZE_ORIGIN ?? "")
  .trim()
  .replace(/\/+$/, "");

/** Default quality for a resized variant, matching next.config's own default. */
const DEFAULT_QUALITY = 75;

/**
 * Build a Cloudflare Image Resizing URL.
 *
 * The source is appended as a full URL rather than as a path, which is what lets
 * a single zone resize images it does not host — the case that matters here,
 * since covers live on publisher domains and Supabase storage, not on our zone.
 */
function resizedViaCloudflare(src: string, width: number, quality: number): string {
  const options = `width=${width},quality=${quality},format=auto,fit=scale-down`;
  return `${RESIZE_ORIGIN}/cdn-cgi/image/${options}/${src}`;
}

export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  if (!src) return src;

  // Inline and blob sources are already in the browser's hands; a round trip
  // through anything can only break them.
  if (src.startsWith("data:") || src.startsWith("blob:")) return src;

  /**
   * Already-sized routes are returned untouched, deliberately.
   *
   * `/api/thumb/post/<id>` accepts `?w=` and resizes before answering, and the
   * generated-thumbnail form is an SVG whose whole design depends on being
   * query-free — which is what lets it pass through caches unmodified. Sending
   * either to Cloudflare would ask a resizer to resize an image that was already
   * resized, and for the SVG it would add the query that breaks its caching.
   */
  if (src.startsWith("/api/thumb/")) return src;

  if (RESIZE_ORIGIN) {
    // A root-relative source cannot be fetched by the resize zone: it would look
    // for the path on the zone's own origin, which does not serve our files. Only
    // absolute sources can be resized this way, so root-relative falls through.
    if (/^https?:\/\//i.test(src)) {
      return resizedViaCloudflare(src, width, quality ?? DEFAULT_QUALITY);
    }
    return src;
  }

  return src;
}
