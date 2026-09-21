import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The `next/image` loader.
 *
 * Two properties matter here and they are different in kind.
 *
 * The first is the *default*: with no resize origin configured the loader must
 * return the source untouched. That is the whole reason it exists — Vercel's
 * optimizer is metered separately and is what ran out — so a loader that quietly
 * started routing images somewhere else again would be a regression nobody would
 * see until the next bill.
 *
 * The second is the pass-through list. `/api/thumb/` must never be rewritten: the
 * stored-cover form is width-addressable and already sized, and the
 * generated-thumbnail form is an SVG whose cacheability depends on being
 * query-free, so appending a resize path would be both redundant and actively
 * harmful.
 *
 * The module reads its env var once at import time, so every case reloads it.
 */

/** Import the loader fresh, with the resize origin set as given. */
async function loadLoader(resizeOrigin?: string) {
  vi.resetModules();
  if (resizeOrigin === undefined) {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_RESIZE_ORIGIN", "");
  } else {
    vi.stubEnv("NEXT_PUBLIC_IMAGE_RESIZE_ORIGIN", resizeOrigin);
  }
  const mod = await import("@/lib/image-loader");
  return mod.default;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with no resize origin configured (the default)", () => {
  it("returns an absolute source unchanged", async () => {
    const loader = await loadLoader();
    const src = "https://publisher.example/photo.jpg";
    expect(loader({ src, width: 400, quality: 75 })).toBe(src);
  });

  it("returns a root-relative source unchanged", async () => {
    const loader = await loadLoader();
    const src = "/uploads/2026/cover.webp";
    expect(loader({ src, width: 640, quality: 75 })).toBe(src);
  });

  it("never points at Vercel's optimizer", async () => {
    // The regression this guards: reintroducing `/_next/image` by falling back
    // to Next's default loader behaviour.
    const loader = await loadLoader();
    const out = loader({ src: "https://publisher.example/photo.jpg", width: 800, quality: 80 });
    expect(out).not.toContain("/_next/image");
  });

  it("tolerates a missing quality by not inventing a query", async () => {
    const loader = await loadLoader();
    const src = "https://publisher.example/photo.jpg";
    expect(loader({ src, width: 400 })).toBe(src);
  });
});

describe("inline sources", () => {
  it.each([
    ["a data URI", "data:image/png;base64,iVBORw0KGgo="],
    ["a blob URL", "blob:https://connectplus.example/abc-123"],
  ])("passes %s through even with resizing configured", async (_label, src) => {
    const loader = await loadLoader("https://cdn.example.com");
    expect(loader({ src, width: 400, quality: 75 })).toBe(src);
  });
});

describe("routes that are already sized", () => {
  it("leaves a stored-cover thumbnail alone even with resizing configured", async () => {
    // Already width-addressable: `/api/thumb/post/<id>` resizes before answering,
    // so a resize path here would be a second resize of the same bytes.
    const loader = await loadLoader("https://cdn.example.com");
    const src = "/api/thumb/post/cmu4dfbad0003ih04wszc2boh";
    expect(loader({ src, width: 400, quality: 75 })).toBe(src);
  });

  it("leaves a generated SVG thumbnail query-free", async () => {
    // Its cacheability depends on having no query string, which is the property
    // that lets it pass through caches unmodified. Appending one would break it.
    const loader = await loadLoader("https://cdn.example.com");
    const src = "/api/thumb/PHN2ZyB4bWxucz0iaHR0cDov";
    const out = loader({ src, width: 400, quality: 75 });
    expect(out).toBe(src);
    expect(out).not.toContain("?");
  });
});

describe("with a Cloudflare resize origin configured", () => {
  const CDN = "https://cdn.example.com";

  it("builds a cdn-cgi/image URL for an absolute source", async () => {
    const loader = await loadLoader(CDN);
    const out = loader({ src: "https://publisher.example/photo.jpg", width: 640, quality: 82 });
    expect(out).toBe(
      `${CDN}/cdn-cgi/image/width=640,quality=82,format=auto,fit=scale-down/https://publisher.example/photo.jpg`
    );
  });

  it("asks for format=auto so the edge negotiates AVIF or WebP", async () => {
    // Without it Cloudflare returns the source format, which defeats the point of
    // putting a resizer in front of the images at all.
    const loader = await loadLoader(CDN);
    expect(loader({ src: "https://publisher.example/p.jpg", width: 400, quality: 75 })).toContain(
      "format=auto"
    );
  });

  it("falls back to the documented default quality when none is given", async () => {
    const loader = await loadLoader(CDN);
    expect(loader({ src: "https://publisher.example/p.jpg", width: 400 })).toContain("quality=75");
  });

  it("still passes a root-relative source through untouched", async () => {
    // A root-relative path is meaningless to the resize zone: it would look for
    // `/uploads/x.jpg` on the CDN's own origin, which does not serve our files.
    // Returning it unchanged is the honest answer — a broken rewrite would be a
    // 404 where a working image used to be.
    const loader = await loadLoader(CDN);
    const src = "/uploads/2026/cover.webp";
    expect(loader({ src, width: 640, quality: 75 })).toBe(src);
  });

  it("tolerates a trailing slash on the configured origin", async () => {
    const loader = await loadLoader(`${CDN}/`);
    const out = loader({ src: "https://publisher.example/p.jpg", width: 400, quality: 75 });
    expect(out.startsWith(`${CDN}/cdn-cgi/image/`)).toBe(true);
    expect(out).not.toContain("//cdn-cgi");
  });

  it("returns the source unchanged for an empty src rather than throwing", async () => {
    const loader = await loadLoader(CDN);
    expect(loader({ src: "", width: 400, quality: 75 })).toBe("");
  });
});
