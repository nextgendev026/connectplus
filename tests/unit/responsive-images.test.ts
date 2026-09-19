import { describe, expect, it } from "vitest";
import {
  isOptimizable,
  optimizedImageSrc,
  responsiveSrcSet,
  sizesForPreset,
  widthsForPreset,
} from "@/lib/image-src";

/**
 * Responsive covers.
 *
 * The defect this closes is silent: a feed card rendered one URL at the preset's
 * maximum width, so a 360px phone downloaded 1200px art. Nothing broke — it was
 * just several times the bytes on every card. These assert the two things that
 * make the fix work and the two ways it silently stops working: a srcset built
 * at one width (no choice offered) and a missing `sizes` (browser assumes
 * viewport-wide and picks the largest candidate anyway).
 */

const COVER = "https://supabase.example.com/storage/v1/object/public/media/a.jpg";

describe("srcset construction", () => {
  it("offers one candidate per width, ascending, each carrying its descriptor", () => {
    const srcSet = responsiveSrcSet(COVER, [1280, 400, 960, 640], { preset: "cover" });
    const entries = srcSet.split(", ");

    expect(entries).toHaveLength(4);
    expect(entries.map((e) => e.split(" ")[1])).toEqual(["400w", "640w", "960w", "1280w"]);
    for (const entry of entries) {
      expect(entry).toContain("/api/optimize?");
      expect(entry).toContain("preset=cover");
    }
  });

  it("reports the widths in the URL so each candidate is a different resource", () => {
    const srcSet = responsiveSrcSet(COVER, [400, 800], { preset: "cover" });
    expect(srcSet).toContain("w=400");
    expect(srcSet).toContain("w=800");
  });

  it("refuses to build a set with nothing to choose from", () => {
    // One candidate is not a choice: the browser would have to take it, so the
    // caller should omit the attribute entirely rather than emit a one-entry set.
    expect(responsiveSrcSet(COVER, [800], { preset: "cover" })).toBe("");
    expect(responsiveSrcSet(COVER, [], { preset: "cover" })).toBe("");
  });

  it("drops duplicates and nonsense widths", () => {
    const srcSet = responsiveSrcSet(COVER, [400, 400, 0, -10, NaN], { preset: "cover" });
    expect(srcSet).toBe("");
    expect(responsiveSrcSet(COVER, [400, 400, 800], { preset: "cover" }).split(", ")).toHaveLength(2);
  });

  it("returns nothing for a source the optimizer passes through", () => {
    // Generated thumbs and inline SVGs are already the bytes we want; four
    // identical candidates would only make the browser do more work.
    expect(responsiveSrcSet("/api/thumb/abc", [400, 800], { preset: "cover" })).toBe("");
    expect(responsiveSrcSet("data:image/svg+xml,%3Csvg%3E", [400, 800], { preset: "cover" })).toBe("");
    expect(responsiveSrcSet("", [400, 800], { preset: "cover" })).toBe("");
    expect(isOptimizable("/api/optimize?url=x")).toBe(false);
  });

  it("carries the other optimise options through to every candidate", () => {
    const srcSet = responsiveSrcSet(COVER, [400, 800], { preset: "thumbnail", quality: 70 });
    for (const entry of srcSet.split(", ")) {
      expect(entry).toContain("preset=thumbnail");
      expect(entry).toContain("q=70");
    }
  });
});

describe("preset defaults", () => {
  it("gives every layout preset more than one width", () => {
    for (const preset of ["cover", "thumbnail", "avatar", "adminThumb"] as const) {
      expect(widthsForPreset(preset).length, preset).toBeGreaterThan(1);
    }
  });

  it("keeps the social-card presets at a single generated size", () => {
    // OG and story cards are rendered server-side at one exact size for a
    // crawler; offering candidates there is meaningless.
    expect(widthsForPreset("og")).toEqual([]);
    expect(widthsForPreset("story")).toEqual([]);
  });

  it("always supplies a sizes string, because a missing one defeats the srcset", () => {
    for (const preset of ["cover", "thumbnail", "avatar", "og", "story", "adminThumb"] as const) {
      const sizes = sizesForPreset(preset);
      expect(sizes.length, preset).toBeGreaterThan(0);
      // `sizes` must be a media-condition list or a single length — never empty
      // and never a bare *.
      expect(sizes).not.toBe("*");
    }
  });

  it("uses a fixed length for presets that render in a fixed box", () => {
    expect(sizesForPreset("avatar")).toMatch(/^\d+px$/);
    expect(sizesForPreset("adminThumb")).toMatch(/^\d+px$/);
  });

  it("describes the real feed layout for covers", () => {
    const sizes = sizesForPreset("cover");
    // One column on a phone, two up at 640px, a fixed column inside the
    // two-column desktop feed.
    expect(sizes).toContain("100vw");
    expect(sizes).toContain("640px");
    expect(sizes).toContain("1024px");
  });
});

describe("the single-size path still works", () => {
  it("returns one URL when a caller pins an exact width", () => {
    const src = optimizedImageSrc(COVER, { preset: "avatar", width: 96, height: 96 });
    expect(src).toContain("w=96");
    expect(src).toContain("h=96");
    expect(src).not.toContain(",");
  });
});
