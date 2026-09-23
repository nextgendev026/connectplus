import { describe, expect, it } from "vitest";
import {
  avatarSrc,
  fallbackSource,
  imageMimeFromUrl,
  isOptimizable,
  optimizedImageSrc,
  requestKey,
} from "@/lib/image-src";

describe("fallbackSource", () => {
  const derived = "/api/optimize?url=https%3A%2F%2Fpublisher.example%2Fa.jpg&preset=cover";
  const original = "https://publisher.example/a.jpg";

  it("uses the derived URL while nothing has failed", () => {
    expect(fallbackSource(derived, original, [])).toBe(derived);
  });

  it("falls back to the original once the derived URL has failed", () => {
    // The exact production case: an image optimizer over quota answers 402 with
    // an HTML body, while the file it was asked to wrap is fine.
    expect(fallbackSource(derived, original, [derived])).toBe(original);
  });

  it("gives up rather than looping when the original fails too", () => {
    // Returning the derived URL again here would re-request what just failed,
    // and the onError handler would fire again — a request loop, not a fallback.
    expect(fallbackSource(derived, original, [derived, original])).toBe("");
  });

  it("ignores an original identical to the derived URL", () => {
    // An unoptimized source has no second chance to offer; offering the same URL
    // would look like a fallback while doing nothing.
    expect(fallbackSource(derived, derived, [derived])).toBe("");
    expect(fallbackSource(derived, null, [derived])).toBe("");
    expect(fallbackSource(derived, "", [derived])).toBe("");
  });

  it("returns nothing for a source that was never resolved", () => {
    expect(fallbackSource("", original, [])).toBe("");
  });

  it("tries at most two URLs, never a third", () => {
    const tried = [derived, original];
    for (const n of [0, 1, 2, 3]) {
      const result = fallbackSource(derived, original, tried.slice(0, n));
      expect([derived, original, ""]).toContain(result);
    }
  });
});

describe("requestKey", () => {
  it("treats a relative URL and its absolute form as the same request", () => {
    // The browser only ever reports `img.currentSrc`, which is absolute, while
    // this module deals in root-relative URLs. Comparing the raw strings never
    // matched, so a real failure of a source went unrecognised.
    expect(requestKey("/api/thumb/post/abc")).toBe(
      requestKey("https://connectplusapp.vercel.app/api/thumb/post/abc")
    );
  });

  it("keeps a srcset candidate distinct from the src it was chosen from", () => {
    // The distinction whose absence blanked covers. A `srcset` candidate fails
    // as `…/abc?w=960`; recording that against `…/abc` told the component its one
    // and only source had died, so it unmounted the image instead of simply
    // asking for the width-less URL that was never tried.
    expect(requestKey("/api/thumb/post/abc?w=960")).not.toBe(requestKey("/api/thumb/post/abc"));
  });

  it("is stable and empty-safe for input it cannot parse", () => {
    // The exact string does not matter — only that the same input always keys
    // the same way, so a failure list stays comparable, and that a missing URL
    // is not mistaken for a URL that failed.
    expect(requestKey("not a url")).toBe(requestKey("not a url"));
    expect(requestKey(null)).toBe("");
    expect(requestKey(undefined)).toBe("");
    expect(requestKey("")).toBe("");
  });
});

describe("fallbackSource with a terminal", () => {
  const derived = "/api/optimize?url=https%3A%2F%2Fpublisher.example%2Fa.jpg&preset=cover";
  const original = "https://publisher.example/a.jpg";
  const branded = "/api/thumb/bWFyay1icmFuZGVk";

  it("rescues a card cover, which has no original to fall back to", () => {
    // `/api/thumb/post/<id>` is both the source and its own derived form, so
    // without a terminal this chain was one link long: the first failure
    // returned `null`, and `null` is not a broken image — it is no image, with
    // nothing on screen to say so.
    const cover = "/api/thumb/post/abc";
    expect(fallbackSource(cover, "", [cover], branded)).toBe(branded);
  });

  it("does not reach for the terminal while an earlier link is still alive", () => {
    expect(fallbackSource(derived, original, [], branded)).toBe(derived);
    expect(fallbackSource(derived, original, [derived], branded)).toBe(original);
  });

  it("lands on the terminal once the original has failed too", () => {
    expect(fallbackSource(derived, original, [derived, original], branded)).toBe(branded);
  });

  it("still gives up rather than repeating itself when the terminal failed as well", () => {
    expect(fallbackSource(derived, original, [derived, original, branded], branded)).toBe("");
  });

  it("is unchanged when no terminal is supplied", () => {
    expect(fallbackSource(derived, original, [derived, original])).toBe("");
  });

  it("terminates on every prefix of the chain it can be handed", () => {
    // The failure mode worth excluding is a cycle: an `<img>` whose onError
    // puts back the URL it was already showing re-requests it forever.
    const chain = [derived, original, branded];
    let seen: string[] = [];
    for (let i = 0; i <= chain.length + 1; i++) {
      const next = fallbackSource(derived, original, seen, branded);
      expect([...chain, ""]).toContain(next);
      if (!next) break;
      expect(seen).not.toContain(next);
      seen = [...seen, next];
    }
    expect(fallbackSource(derived, original, seen, branded)).toBe("");
  });
});

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
