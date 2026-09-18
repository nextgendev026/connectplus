import { describe, expect, it } from "vitest";
import { avatarSrc, imageMimeFromUrl, isOptimizable, optimizedImageSrc } from "@/lib/image-src";

describe("optimizedImageSrc", () => {
  it("routes remote and root-relative images through the optimizer", () => {
    const url = optimizedImageSrc("https://cdn.example.com/a.jpg", { preset: "cover" });
    expect(url.startsWith("/api/optimize?")).toBe(true);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("url")).toBe("https://cdn.example.com/a.jpg");
    expect(params.get("preset")).toBe("cover");
  });

  it("carries explicit width, height and quality overrides", () => {
    const params = new URLSearchParams(
      optimizedImageSrc("/uploads/a.png", { preset: "thumbnail", width: 400, height: 300, quality: 80 }).split("?")[1]
    );
    expect(params.get("w")).toBe("400");
    expect(params.get("h")).toBe("300");
    expect(params.get("q")).toBe("80");
  });

  it("passes already-optimal sources through untouched", () => {
    expect(optimizedImageSrc("/api/thumb/abc", {})).toBe("/api/thumb/abc");
    expect(optimizedImageSrc("data:image/png;base64,AAAA", {})).toBe("data:image/png;base64,AAAA");
    expect(optimizedImageSrc("blob:xyz", {})).toBe("blob:xyz");
  });

  it("returns an empty string for a missing source so callers can fall back", () => {
    expect(optimizedImageSrc(null, {})).toBe("");
    expect(optimizedImageSrc(undefined, {})).toBe("");
    expect(optimizedImageSrc("   ", {})).toBe("");
  });
});

describe("isOptimizable", () => {
  it("is true only for remote or root-relative sources", () => {
    expect(isOptimizable("https://x.example/a.jpg")).toBe(true);
    expect(isOptimizable("/uploads/a.jpg")).toBe(true);
    expect(isOptimizable("/api/thumb/x")).toBe(false);
    expect(isOptimizable("data:image/png;base64,AA")).toBe(false);
    expect(isOptimizable("")).toBe(false);
  });
});

describe("imageMimeFromUrl", () => {
  it("maps extensions, ignoring query strings", () => {
    expect(imageMimeFromUrl("https://x.example/a.webp?w=1")).toBe("image/webp");
    expect(imageMimeFromUrl("/uploads/a.PNG")).toBe("image/png");
    expect(imageMimeFromUrl("https://x.example/a.jpeg")).toBe("image/jpeg");
    expect(imageMimeFromUrl("https://x.example/a")).toBe("image/jpeg");
  });
});

describe("avatarSrc", () => {
  it("uses the real avatar when present", () => {
    expect(avatarSrc("https://cdn.example.com/me.png", "Ada")).toBe("https://cdn.example.com/me.png");
  });

  it("mints an inline SVG fallback with the author's initials", () => {
    const src = avatarSrc(null, "Achieng Otieno");
    expect(src.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(src.slice("data:image/svg+xml,".length));
    expect(svg).toContain(">AO<");
  });

  it("is deterministic for the same name and never calls a third party", () => {
    expect(avatarSrc(null, "Ada")).toBe(avatarSrc(null, "Ada"));
    expect(avatarSrc(undefined, "Ada")).not.toContain("pravatar");
  });
});
