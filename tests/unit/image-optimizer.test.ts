import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  cacheHeaders,
  negotiatedFormat,
  optimizeImage,
  presetForKind,
  PRESETS,
} from "@/lib/image-optimizer";

/** A JPEG large enough to need a downscale for the cover preset. */
async function largeJpeg(): Promise<Buffer> {
  return sharp({
    create: { width: 2000, height: 1200, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
}

/** A JPEG carrying EXIF orientation + density, for the strip/keep tests. */
async function jpegWithMetadata(): Promise<Buffer> {
  const base = await sharp({
    create: { width: 200, height: 160, channels: 3, background: "#888888" },
  })
    .jpeg()
    .toBuffer();
  return sharp(base).withMetadata({ orientation: 6, density: 300 }).jpeg().toBuffer();
}

describe("optimizeImage", () => {
  it("downscales to the preset bounds and converts to the preset format", async () => {
    const result = await optimizeImage(await largeJpeg(), "cover");
    expect(result.format).toBe("webp");
    expect(result.contentType).toBe("image/webp");
    expect(result.width).toBeLessThanOrEqual(PRESETS.cover!.maxWidth);
    expect(result.height).toBeLessThanOrEqual(PRESETS.cover!.maxHeight);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("strips EXIF metadata by default", async () => {
    // Regression: the engine used to call `withMetadata({})` when stripping,
    // which does the opposite — it re-attached the source EXIF. Density and
    // orientation are the visible proof that metadata survived.
    const result = await optimizeImage(await jpegWithMetadata(), "cover");
    const meta = await sharp(result.buffer).metadata();
    expect(meta.orientation).toBeUndefined();
  });

  it("keeps metadata when the preset asks for it", async () => {
    const keep = { ...PRESETS.cover!, stripMetadata: false };
    const result = await optimizeImage(await jpegWithMetadata(), keep);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.orientation).toBe(6);
  });

  it("returns the original buffer instead of throwing on a bad image", async () => {
    const garbage = Buffer.from("this is not an image");
    const result = await optimizeImage(garbage, "cover");
    expect(result.buffer.equals(garbage)).toBe(true);
    expect(result.unchanged).toBe(true);
  });

  it("falls back to the default preset for an unknown name", async () => {
    const result = await optimizeImage(await largeJpeg(), "nonsense-preset");
    expect(result.width).toBeLessThanOrEqual(1200);
  });
});

describe("presetForKind", () => {
  it("maps each upload kind to its surface-tuned preset", () => {
    expect(presetForKind("avatar").maxWidth).toBe(PRESETS.avatar!.maxWidth);
    expect(presetForKind("cover").maxWidth).toBe(PRESETS.cover!.maxWidth);
    expect(presetForKind("post").maxWidth).toBe(PRESETS.thumbnail!.maxWidth);
  });

  it("falls back to the default preset for an unknown kind", () => {
    expect(presetForKind("mystery").maxWidth).toBe(1200);
  });
});

describe("negotiatedFormat", () => {
  it("prefers the smallest format the client can decode", () => {
    expect(negotiatedFormat("image/avif,image/webp,image/*")).toBe("avif");
    expect(negotiatedFormat("image/webp,image/*")).toBe("webp");
    expect(negotiatedFormat("image/jpeg")).toBe("jpeg");
  });

  it("uses the caller's preference when the header is absent", () => {
    expect(negotiatedFormat(null, "webp")).toBe("webp");
  });
});

describe("cacheHeaders", () => {
  it("caches immutable surfaces hardest", () => {
    expect(cacheHeaders("avatar")["Cache-Control"]).toContain("immutable");
    expect(cacheHeaders("thumbnail")["Cache-Control"]).toContain("immutable");
  });

  it("lets covers revalidate rather than caching forever", () => {
    const cover = cacheHeaders("cover")["Cache-Control"] ?? "";
    expect(cover).toContain("stale-while-revalidate");
    expect(cover).not.toContain("immutable");
  });
});
