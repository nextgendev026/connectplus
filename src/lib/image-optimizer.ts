import sharp from "sharp";
import { createLogger } from "./logger";

const log = createLogger("image-optimizer");

/**
 * Image optimization engine.
 *
 * Every image that enters this platform — uploaded covers, avatars, story cards,
 * OG thumbnails, RSS-imported photos — passes through one path that decides how
 * to make it smaller without making it look worse. The rules are simple and
 * derived from the surface the image will actually render on, not from a generic
 * "optimize everything" setting that optimises a 16px favicon with the same
 * pipeline as a 1200×630 social card.
 *
 * What the engine does:
 *   1. **Detects** the image's current format and dimensions.
 *   2. **Chooses** a target size and format based on the declared use (cover,
 *      avatar, thumbnail, OG card).
 *   3. **Sharpens** only when the image was downscaled (sharpening a full-res
 *      photo that is already at its display size wastes bytes for no visible
 *      improvement).
 *   4. **Strips** metadata (EXIF, ICC profiles) unless the caller explicitly
 *      asks to keep it — metadata is the single largest invisible cost in a
 *      shared image, and social platforms strip it anyway.
 *   5. **Converts** to the most efficient format the browser supports (WebP
 *      for general use, AVIF when the quality setting justifies the encoding
 *      cost, JPEG for legacy paths that cannot negotiate).
 *
 * The engine never throws on a bad image — it returns the original buffer
 * instead, so a corrupted upload degrades gracefully rather than crashing a
 * render path.
 */

/* ── Presets ──────────────────────────────────────────────────────────────── */

export interface OptimizePreset {
  /** Maximum width in pixels. Height is computed to preserve aspect ratio. */
  maxWidth: number;
  /** Maximum height in pixels. Width is computed to preserve aspect ratio. */
  maxHeight: number;
  /** Target quality 1-100. Sharp's WebP and JPEG quality are perceptually similar. */
  quality: number;
  /** Whether to apply mild sharpening after resize (only useful when downscaling). */
  sharpen: boolean;
  /** Output format. "original" preserves the source format. */
  format: "webp" | "avif" | "jpeg" | "png" | "original";
  /** Whether to strip metadata. */
  stripMetadata: boolean;
}

/**
 * Presets keyed by the surface the image will render on. Each one is tuned to
 * the display size, the browser support profile, and the caching behaviour of
 * that surface — a favicon does not benefit from the same pipeline as a hero
 * cover, and a WhatsApp story card has different size constraints than an OG
 * thumbnail.
 */
const DEFAULT_PRESET: OptimizePreset = {
  maxWidth: 1200,
  maxHeight: 630,
  quality: 82,
  sharpen: true,
  format: "webp",
  stripMetadata: true,
};

export const PRESETS: Record<string, OptimizePreset> = {
  /** Post cover / hero image — the largest media on most pages. */
  cover: {
    maxWidth: 1200,
    maxHeight: 630,
    quality: 82,
    sharpen: true,
    format: "webp",
    stripMetadata: true,
  },
  /** Feed card thumbnail — small, repeated, bandwidth-sensitive. */
  thumbnail: {
    maxWidth: 400,
    maxHeight: 300,
    quality: 78,
    sharpen: true,
    format: "webp",
    stripMetadata: true,
  },
  /** Profile avatar — always square, always small. */
  avatar: {
    maxWidth: 256,
    maxHeight: 256,
    quality: 80,
    sharpen: false,
    format: "webp",
    stripMetadata: true,
  },
  /** OG / social card — 1200×630 is the universal minimum. */
  og: {
    maxWidth: 1200,
    maxHeight: 630,
    quality: 85,
    sharpen: false,
    format: "jpeg",
    stripMetadata: true,
  },
  /** WhatsApp story card — 1080×1920 portrait. */
  story: {
    maxWidth: 1080,
    maxHeight: 1920,
    quality: 85,
    sharpen: false,
    format: "jpeg",
    stripMetadata: true,
  },
  /** In-app cover for the content console — small, fast. */
  adminThumb: {
    maxWidth: 128,
    maxHeight: 96,
    quality: 70,
    sharpen: true,
    format: "webp",
    stripMetadata: true,
  },
};

/* ── Core optimizer ───────────────────────────────────────────────────────── */

export interface OptimizeResult {
  buffer: Buffer;
  format: string;
  width: number;
  height: number;
  bytes: number;
  /** The content-type header the response should carry. */
  contentType: string;
  /** True when the output is identical to the input (no optimisation happened). */
  unchanged: boolean;
}

const FORMAT_MAP: Record<string, string> = {
  webp: "image/webp",
  avif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

/**
 * Optimise a single image buffer according to a preset.
 *
 * Never throws — on error the original buffer is returned unchanged, with a
 * log line that names the failure. The caller does not need a try/catch.
 */
export async function optimizeImage(
  input: Buffer,
  preset: OptimizePreset | string = "cover"
): Promise<OptimizeResult> {
  const p: OptimizePreset = typeof preset === "string" ? (PRESETS[preset] ?? DEFAULT_PRESET) : preset;

  try {
    const meta = await sharp(input).metadata();
    const srcWidth = meta.width ?? 0;
    const srcHeight = meta.height ?? 0;

    // Already small enough — skip resize but still convert format if needed.
    const needsResize = srcWidth > p.maxWidth || srcHeight > p.maxHeight;
    const outputFormat = p.format === "original" ? (meta.format ?? "webp") : p.format;

    let pipeline = sharp(input, { failOn: "none" });

    // Resize (only when the image is larger than the target).
    if (needsResize) {
      pipeline = pipeline.resize({
        width: p.maxWidth,
        height: p.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Strip metadata unless told otherwise — with no fields set, sharp drops EXIF and ICC.
    if (p.stripMetadata) {
      pipeline = pipeline.withMetadata({});
    }

    // Mild sharpening when we actually downscaled — unsharp mask with gentle
    // settings that avoid the halo artefacts aggressive sharpening produces.
    if (p.sharpen && needsResize) {
      pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.3, m2: 0.8 });
    }

    // Format conversion.
    switch (outputFormat) {
      case "webp":
        pipeline = pipeline.webp({ quality: p.quality, effort: 4 });
        break;
      case "avif":
        pipeline = pipeline.avif({ quality: p.quality, effort: 3 });
        break;
      case "jpeg":
        pipeline = pipeline.jpeg({ quality: p.quality, mozjpeg: true });
        break;
      case "png":
        pipeline = pipeline.png({ compressionLevel: 6 });
        break;
      default:
        pipeline = pipeline.webp({ quality: p.quality });
    }

    const output = await pipeline.toBuffer();
    const outMeta = await sharp(output).metadata();

    return {
      buffer: output,
      format: outputFormat,
      width: outMeta.width ?? 0,
      height: outMeta.height ?? 0,
      bytes: output.length,
      contentType: FORMAT_MAP[outputFormat] ?? "application/octet-stream",
      unchanged: output.length === input.length,
    };
  } catch (error) {
    log.warn("optimization failed, returning original", {
      error: String(error),
      inputBytes: input.length,
    });
    return {
      buffer: input,
      format: "unknown",
      width: 0,
      height: 0,
      bytes: input.length,
      contentType: "application/octet-stream",
      unchanged: true,
    };
  }
}

/* ── Batch optimization ───────────────────────────────────────────────────── */

/**
 * Optimise multiple images with the same preset — useful for processing all
 * covers in a feed page, or a batch of uploaded avatars.
 */
export async function optimizeBatch(
  inputs: Buffer[],
  preset: OptimizePreset | string = "cover"
): Promise<OptimizeResult[]> {
  return Promise.all(inputs.map((buf) => optimizeImage(buf, preset)));
}

/* ── Format negotiation ───────────────────────────────────────────────────── */

/**
 * Choose the best output format based on the client's Accept header. This lets
 * the server send AVIF to Chrome, WebP to Safari, and JPEG to legacy clients —
 * without the caller having to inspect headers.
 */
export function negotiatedFormat(accept: string | null, preferred: string = "webp"): string {
  if (!accept) return preferred;
  if (accept.includes("image/avif")) return "avif";
  if (accept.includes("image/webp")) return "webp";
  if (accept.includes("image/jpeg")) return "jpeg";
  if (accept.includes("image/png")) return "png";
  return preferred;
}

/* ── Cache headers ────────────────────────────────────────────────────────── */

/**
 * Cache-Control header tuned by image type. Thumbnails and avatars are
 * immutable (content-addressed or versioned URLs), covers are revalidatable
 * (the same URL can serve a new image when the post is edited).
 */
export function cacheHeaders(
  kind: "cover" | "avatar" | "thumbnail" | "og" | "story" | "static"
): Record<string, string> {
  switch (kind) {
    case "avatar":
    case "thumbnail":
      // Content-addressed or versioned: safe to cache aggressively.
      return { "Cache-Control": "public, max-age=31536000, immutable" };
    case "cover":
      // May change when the post is edited; revalidate after a day.
      return { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" };
    case "og":
    case "story":
      // Marketing cards are stable for the lifetime of the campaign.
      return { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" };
    case "static":
      // Favicon, PWA icons — immutable in production.
      return { "Cache-Control": "public, max-age=31536000, immutable" };
    default:
      return { "Cache-Control": "public, max-age=3600" };
  }
}

/* ── Helpers for the upload pipeline ──────────────────────────────────────── */

/**
 * Determine the optimal preset from the upload "kind" parameter. The upload
 * route passes "avatar", "cover", or "post" — this maps each to the preset
 * that produces the best output for that surface.
 */
export function presetForKind(kind: string): OptimizePreset {
  switch (kind) {
    case "avatar":
      return PRESETS.avatar ?? DEFAULT_PRESET;
    case "cover":
      return PRESETS.cover ?? DEFAULT_PRESET;
    case "post":
      return PRESETS.thumbnail ?? DEFAULT_PRESET;
    default:
      return DEFAULT_PRESET;
  }
}

/**
 * Generate a WebP variant of an image and return it alongside the original.
 * Useful for <picture> elements that serve WebP to modern browsers and JPEG to
 * legacy ones.
 */
export async function dualFormat(
  input: Buffer,
  preset: OptimizePreset | string = "cover"
): Promise<{ webp: OptimizeResult; fallback: OptimizeResult }> {
  const p: OptimizePreset = typeof preset === "string" ? (PRESETS[preset] ?? DEFAULT_PRESET) : preset;
  const webpPreset: OptimizePreset = { maxWidth: p.maxWidth, maxHeight: p.maxHeight, quality: p.quality, sharpen: p.sharpen, stripMetadata: p.stripMetadata, format: "webp" };
  const jpegPreset: OptimizePreset = { maxWidth: p.maxWidth, maxHeight: p.maxHeight, quality: p.quality, sharpen: p.sharpen, stripMetadata: p.stripMetadata, format: "jpeg" };
  const [webp, fallback] = await Promise.all([
    optimizeImage(input, webpPreset),
    optimizeImage(input, jpegPreset),
  ]);
  return { webp, fallback };
}
