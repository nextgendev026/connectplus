import { describe, expect, it } from "vitest";
import {
  SHARE_TARGETS,
  buildShareMessage,
  canonicalShareUrl,
  clampText,
  createShareTargets,
  normalizeHashtags,
  shareImage,
  withAttribution,
} from "@/lib/share";
import { DEFAULT_OG_IMAGE } from "@/lib/brand";

const ORIGIN = "https://connectplus.example";

describe("attribution", () => {
  it("adds campaign params without disturbing the query it is given", () => {
    const url = withAttribution("/sports?tab=tips", { source: "whatsapp", campaign: "tips" });
    expect(url).toContain("/sports?tab=tips");
    expect(url).toContain("utm_source=whatsapp");
    expect(url).toContain("utm_medium=share");
    expect(url).toContain("utm_campaign=tips");
  });

  it("keeps a relative URL relative, so server and browser agree", () => {
    expect(withAttribution("/article/x", { source: "x" }).startsWith("http")).toBe(false);
  });

  it("keeps an absolute URL absolute", () => {
    const url = withAttribution(`${ORIGIN}/article/x`, { source: "x" }, ORIGIN);
    expect(url.startsWith(`${ORIGIN}/article/x`)).toBe(true);
  });

  it("resolves a relative URL against a supplied origin", () => {
    const url = withAttribution("/article/x", { source: "x" }, ORIGIN);
    expect(url.startsWith(`${ORIGIN}/article/x`)).toBe(true);
  });

  it("replaces an attribution already on the URL rather than stacking it", () => {
    const once = withAttribution("/sports", { source: "x", campaign: "tips" });
    const twice = withAttribution(once, { source: "facebook", campaign: "tips" });
    expect(twice).toContain("utm_source=facebook");
    expect(twice).not.toContain("utm_source=x");
    expect(twice.match(/utm_source=/g)).toHaveLength(1);
  });

  it("never throws on a URL it did not author", () => {
    expect(withAttribution("not a url at all", { source: "x" })).toBe("not a url at all");
    expect(withAttribution("", { source: "x" })).toBe("");
  });
});

describe("hashtags", () => {
  it("sanitises tags so a platform cannot cut them short", () => {
    expect(normalizeHashtags(["Betting Tips", "#over/under"])).toEqual([
      "connectPlus",
      "BettingTips",
      "overunder",
    ]);
  });

  it("always carries the brand tag, first", () => {
    expect(normalizeHashtags(["Sports"])[0]).toBe("connectPlus");
  });

  it("does not duplicate the brand tag when the caller already sent it", () => {
    const tags = normalizeHashtags(["connectplus", "Sports"]);
    expect(tags.filter((t) => t.toLowerCase() === "connectplus")).toHaveLength(1);
  });

  it("keeps the brand tag when trimming to the limit", () => {
    const tags = normalizeHashtags(["Sports", "Tips", "Kenya"], 2);
    expect(tags).toHaveLength(2);
    expect(tags[0]?.toLowerCase()).toBe("connectplus");
  });
});

describe("message", () => {
  const input = {
    title: "Arsenal vs Chelsea: Over 2.5 (61%)",
    description: "Total goals — the connectPlus model's pick for the Premier League.",
    hashtags: ["connectPlus", "Sports"],
  };

  it("leads with the claim, then the detail, then the tags", () => {
    const message = buildShareMessage({ ...input });
    expect(message.startsWith("Arsenal vs Chelsea: Over 2.5 (61%)")).toBe(true);
    expect(message).toContain("— Total goals");
    expect(message.trimEnd().endsWith("#connectPlus #Sports")).toBe(true);
  });

  it("never exceeds the budget it is given", () => {
    for (const budget of [120, 200, 280, 600]) {
      const message = buildShareMessage({ ...input, maxLength: budget });
      expect(message.length).toBeLessThanOrEqual(budget);
    }
  });

  it("drops the detail rather than eating the headline when space is tight", () => {
    const message = buildShareMessage({ ...input, maxLength: 90 });
    expect(message).toContain("Arsenal vs Chelsea");
    expect(message.trimEnd().endsWith("#connectPlus #Sports")).toBe(true);
  });

  it("falls back to a brand line when there is no title", () => {
    expect(buildShareMessage({ title: "   " })).toContain("connectPlus");
  });

  it("has no double spaces and no dangling punctuation", () => {
    const message = buildShareMessage({ ...input, maxLength: 110 });
    expect(message).not.toMatch(/\s{2}/);
    expect(message).not.toMatch(/[—–-]\s*$/);
  });
});

describe("clampText", () => {
  it("cuts at a word boundary and marks the cut", () => {
    expect(clampText("the quick brown fox jumps", 19)).toBe("the quick brown…");
  });

  it("leaves text that fits alone", () => {
    expect(clampText("short enough", 40)).toBe("short enough");
  });
});

describe("targets", () => {
  const prepared = createShareTargets({
    url: "/sports?tab=tips&pick=abc",
    title: "Arsenal vs Chelsea: Over 2.5 (61%)",
    description: "Total goals — the model's pick.",
    hashtags: ["Sports"],
    campaign: "tips",
    content: "pick",
    origin: ORIGIN,
  });

  it("gives every channel exactly one entry", () => {
    expect(prepared).toHaveLength(SHARE_TARGETS.length);
    expect(prepared.map((p) => p.target.id)).toContain("whatsapp");
  });

  it("attributes every channel to itself, with the deep link intact", () => {
    const sources = new Set<string>();
    for (const share of prepared) {
      expect(share.url).toContain("tab=tips");
      expect(share.url).toContain("pick=abc");
      expect(share.url).toContain(`utm_source=${share.target.source}`);
      expect(share.url).toContain("utm_content=pick");
      sources.add(share.target.source);
    }
    expect(sources.size).toBe(SHARE_TARGETS.length);
  });

  it("keeps the link out of X's text field, which counts it separately", () => {
    const x = prepared.find((p) => p.target.id === "x");
    expect(x?.href).toContain("x.com/intent/post");
    expect(x?.href).toContain("url=");
    expect(x?.message).not.toContain("http");
  });

  it("puts the link in the same field for WhatsApp, where it is one message", () => {
    const wa = prepared.find((p) => p.target.id === "whatsapp");
    expect(wa?.text).toContain(encodeURIComponent(ORIGIN).slice(0, 8) === "" ? "" : ORIGIN);
    expect(wa?.text).toContain("utm_source=whatsapp");
  });

  it("still renders LinkedIn, which ignores sharer text", () => {
    const li = prepared.find((p) => p.target.id === "linkedin");
    expect(li?.href).toBe(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(li?.url ?? "")}`);
  });

  it("gives email a subject and a body that both survive encoding", () => {
    const mail = prepared.find((p) => p.target.id === "email");
    expect(mail?.href).toContain("mailto:?subject=");
    expect(mail?.href).toContain("body=");
    expect(mail?.href).not.toContain("\n");
  });

  it("has no endpoint for the clipboard target", () => {
    const copy = prepared.find((p) => p.target.id === "copy");
    expect(copy?.href).toBeNull();
    expect(copy?.text).toContain("utm_source=copy");
  });

  it("fits every message inside its channel's budget", () => {
    for (const share of prepared) {
      expect(share.message.length).toBeLessThanOrEqual(share.target.textBudget);
    }
  });

  it("survives a share with no origin at all (server render)", () => {
    const shares = createShareTargets({ url: "/sports", title: "Tips" });
    expect(shares.find((p) => p.target.id === "x")?.url).toContain("/sports");
  });
});

describe("image and canonical URL", () => {
  it("falls back to the generated card, not the square icon", () => {
    expect(shareImage(null)).toBe(DEFAULT_OG_IMAGE);
    expect(shareImage("")).toBe(DEFAULT_OG_IMAGE);
  });

  it("resolves a relative cover against the origin", () => {
    expect(shareImage("/api/thumb/post/1", ORIGIN)).toBe(`${ORIGIN}/api/thumb/post/1`);
  });

  it("leaves a publisher-independent absolute image alone", () => {
    expect(shareImage("https://cdn.example/a.jpg", ORIGIN)).toBe("https://cdn.example/a.jpg");
  });

  it("resolves the canonical URL once, without attribution", () => {
    expect(canonicalShareUrl({ url: "/article/x", title: "", origin: ORIGIN })).toBe(`${ORIGIN}/article/x`);
    expect(canonicalShareUrl({ url: `${ORIGIN}/article/x`, title: "", origin: ORIGIN })).toBe(`${ORIGIN}/article/x`);
  });
});
