import { describe, expect, it } from "vitest";
import {
  buildMarketingBrief,
  buildPostShareCopy,
  composeFallbackCampaigns,
  groundedNumbers,
  parseCampaigns,
  scoreCampaign,
  ungroundedNumbers,
  type MarketingSignals,
} from "../../src/lib/marketing";

/**
 * Marketing engine contract.
 *
 * These are the pure parts — the brief that becomes the model's input, the
 * scorer that judges what comes back, the parser that has to survive a real LLM
 * reply, and the composer that keeps a deployment with no API key from looking
 * broken. They are tested apart from the network for the same reason they are
 * written apart: what the platform SAYS about itself is the one thing here that
 * cannot be taken back, so the rules are pinned rather than trusted.
 */

function signals(overrides: Partial<MarketingSignals> = {}): MarketingSignals {
  return {
    generatedAt: "2026-09-17T10:00:00.000Z",
    origin: "https://connectplus.test",
    counts: { published: 911, publishedLast7d: 42, writers: 128, categories: 12, views: 512_400 },
    topStory: { title: "Kenya's grid adds solar", slug: "kenya-grid-solar", views: 12_400 },
    hive: {
      online: true,
      memories: 4_812,
      topTopics: [
        { topic: "solar", count: 22 },
        { topic: "harambee", count: 14 },
      ],
    },
    trends: [
      { subject: "solar tariffs", velocity: 91, platform: 22 },
      { subject: "afcon qualifiers", velocity: 77, platform: 18 },
    ],
    sports: { settled: 640, accuracy: 61 },
    gaps: [
      { category: "Culture", posts: 3 },
      { category: "Tech", posts: 9 },
    ],
    ...overrides,
  };
}

describe("buildMarketingBrief", () => {
  it("phrases every proof point with a number that exists in the signals", () => {
    const brief = buildMarketingBrief(signals());
    expect(brief.proofPoints.some((p) => p.includes("911"))).toBe(true);
    expect(brief.proofPoints.some((p) => p.includes("61%") && p.includes("640"))).toBe(true);
    expect(brief.proofPoints.some((p) => p.includes("Kenya's grid adds solar"))).toBe(true);
  });

  it("leads its hooks with something measurable, and never returns none", () => {
    const brief = buildMarketingBrief(signals());
    expect(brief.hooks.length).toBeGreaterThan(0);
    expect(brief.hooks.some((h) => /\d/.test(h))).toBe(true);

    // A brand-new deployment has no reads, no writers and no settled picks —
    // the hook must still be a sentence rather than an empty array.
    const empty = buildMarketingBrief(
      signals({
        counts: { published: 0, publishedLast7d: 0, writers: 0, categories: 0, views: 0 },
        topStory: null,
        hive: { online: false, memories: 0, topTopics: [] },
        trends: [],
        sports: { settled: 0, accuracy: null },
        gaps: [],
      })
    );
    expect(empty.hooks).toHaveLength(1);
    expect(empty.proofPoints).toHaveLength(0);
    expect(empty.summary).toContain("0 stories");
  });

  it("falls back to hive topics when platform heat has not been measured", () => {
    const brief = buildMarketingBrief(signals({ trends: [] }));
    expect(brief.hooks.join(" ")).toContain("solar");
  });

  it("carries the configured hashtags, always including the brand tag", () => {
    const brief = buildMarketingBrief(signals(), { hashtags: ["EastAfrica"] });
    expect(brief.hashtags).toContain("EastAfrica");
    expect(brief.hashtags.map((t) => t.toLowerCase())).toContain("connectplus");
  });

  it("names the coverage gaps, because that is what an editor can act on", () => {
    expect(buildMarketingBrief(signals()).summary).toContain("Culture (3)");
  });
});

describe("scoreCampaign", () => {
  const good = {
    title: "A model that publishes its own record",
    body: "Across 640 settled picks the model has won 61%. Every prediction arrives with its reasoning. Read the board.",
    hashtags: ["connectPlus", "EastAfrica"],
  };

  it("scores copy built on a fact above copy built on adjectives", () => {
    const factual = scoreCampaign(good, { link: "https://connectplus.test/sports" });
    const vague = scoreCampaign({
      title: "Amazing",
      body: "We are truly amazing and revolutionary. Wow.",
      hashtags: [],
    });
    expect(factual).toBeGreaterThan(vague);
    expect(factual).toBeGreaterThan(70);
  });

  it("penalises shouting, hashtag stuffing and emoji walls", () => {
    const base = scoreCampaign({ title: "Today on connectPlus", body: "Read the story on connectPlus today.", hashtags: ["connectPlus"] });
    const shouted = scoreCampaign({
      title: "Today on connectPlus",
      body: "READ THE STORY ON CONNECTPLUS TODAY RIGHT NOW",
      hashtags: ["connectPlus"],
    });
    expect(shouted).toBeLessThan(base);

    const stuffed = scoreCampaign({
      title: "Today on connectPlus",
      body: "Read the story on connectPlus today.",
      hashtags: ["a", "b", "c", "d", "e", "f", "g", "h"],
    });
    expect(stuffed).toBeLessThan(base);

    const emojiWall = scoreCampaign({
      title: "Today on connectPlus",
      body: "Read the story on connectPlus today 😀😀😀😀😀😀",
      hashtags: ["connectPlus"],
    });
    expect(emojiWall).toBeLessThan(base);
  });

  it("rewards the brand hashtag and stays inside 0-100", () => {
    const without = scoreCampaign({ title: "Ship it", body: "A short one.", hashtags: [] });
    const withBrand = scoreCampaign({ title: "Ship it", body: "A short one.", hashtags: ["connectPlus"] });
    expect(withBrand).toBeGreaterThan(without);
    expect(scoreCampaign(good)).toBeLessThanOrEqual(100);
    expect(scoreCampaign({ title: "", body: "", hashtags: [] })).toBeGreaterThanOrEqual(0);
  });

  it("rewards copy that says what to do next", () => {
    const linked = scoreCampaign(
      { title: "Solar at scale", body: "12,400 reads on one story. Read it now.", hashtags: ["connectPlus"] },
      { link: "https://connectplus.test/article/x" }
    );
    const passive = scoreCampaign(
      { title: "Solar at scale", body: "12,400 reads on one story.", hashtags: ["connectPlus"] },
      { link: "https://connectplus.test/article/x" }
    );
    expect(linked).toBeGreaterThan(passive);
  });
});

describe("grounding", () => {
  const brief = buildMarketingBrief(signals());

  it("collects the numbers the brief actually contains", () => {
    const allowed = groundedNumbers(brief);
    expect(allowed).toContain(911);
    expect(allowed).toContain(42);
    // Separators and percentages are read as the numbers they name.
    expect(allowed).toContain(61);
    expect(allowed).toContain(12_400);
  });

  it("catches the invented figure that got through review in practice", () => {
    // The real failure: the brief held "911 stories" and "42 in the last seven
    // days", and the model wrote "729 stories in seven days".
    expect(ungroundedNumbers("729 stories in seven days. Nairobi's reading room is full.", brief)).toEqual(["729"]);
  });

  it("passes a figure quoted verbatim, with or without its separators", () => {
    expect(ungroundedNumbers("911 stories published so far", brief)).toEqual([]);
    // The brief says 12,400 reads on the top story; "12.4K" is the same figure.
    expect(ungroundedNumbers("12.4K reads on one story", brief)).toEqual([]);
    // And a 2% drift is a count that moved, not a fabrication.
    expect(ungroundedNumbers("911 stories and 12,350 reads", brief)).toEqual([]);
  });

  it("prices an invention above anything tone and length can earn", () => {
    const honest = {
      title: "42 stories this week",
      body: "42 stories were published in the last seven days. Read the feed and follow the writers.",
      hashtags: ["connectPlus"],
    };
    const invented = { ...honest, title: "729 stories this week", body: honest.body.replace("42 stories", "729 stories") };
    const scored = scoreCampaign(honest, { brief });
    const caught = scoreCampaign(invented, { brief });
    expect(scored).toBeGreaterThan(caught);
    // The point of the penalty: it cannot clear a sensible auto-publish bar.
    expect(caught).toBeLessThan(78);
  });

  it("checks only when a brief is supplied, so manual copy is never penalised blind", () => {
    const copy = { title: "Anything", body: "123,456 readers agree.", hashtags: [] };
    expect(scoreCampaign(copy)).toBe(scoreCampaign(copy, {}));
  });
});

describe("parseCampaigns", () => {
  it("recovers a JSON array from a fenced, chatty reply", () => {
    const raw = `Here you go!\n\`\`\`json\n[{"kind":"social","channel":"facebook","title":"Grid watch","body":"12,400 reads. Read it.","hashtags":["connectPlus"]}]\n\`\`\`\nHope this helps.`;
    const parsed = parseCampaigns(raw, 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("Grid watch");
    expect(parsed[0]?.hashtags).toEqual(["connectPlus"]);
  });

  it("drops rows with no copy instead of publishing them blank", () => {
    const parsed = parseCampaigns('[{"title":"","body":"x"},{"title":"ok","body":"y"}]', 5);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe("ok");
  });

  it("coerces unknown kinds and channels rather than losing the copy", () => {
    const parsed = parseCampaigns('[{"kind":"billboard","channel":"telegram","title":"Hi","body":"There"}]', 5);
    expect(parsed[0]?.kind).toBe("social");
    expect(parsed[0]?.channel).toBe("facebook");
  });

  it("respects the requested limit and survives rubbish", () => {
    const three = '[{"title":"a","body":"1"},{"title":"b","body":"2"},{"title":"c","body":"3"}]';
    expect(parseCampaigns(three, 2)).toHaveLength(2);
    expect(parseCampaigns("no array here", 3)).toEqual([]);
    expect(parseCampaigns(null, 3)).toEqual([]);
    expect(parseCampaigns("[{", 3)).toEqual([]);
  });
});

describe("composeFallbackCampaigns", () => {
  it("always produces copy, brief-only, so a keyless deployment still markets", () => {
    const brief = buildMarketingBrief(signals());
    const campaigns = composeFallbackCampaigns(brief, signals(), 5);
    expect(campaigns.length).toBe(5);
    for (const campaign of campaigns) {
      expect(campaign.title.length).toBeGreaterThan(0);
      expect(campaign.body.length).toBeGreaterThan(40);
      expect(campaign.rationale?.length).toBeGreaterThan(0);
    }
  });

  it("opens with a real hook and mentions the coverage gaps", () => {
    const brief = buildMarketingBrief(signals());
    const campaigns = composeFallbackCampaigns(brief, signals(), 5);
    expect(campaigns[0]?.body).toContain("Kenya's grid adds solar");
    expect(campaigns.some((c) => c.body.includes("Culture"))).toBe(true);
  });

  it("clamps an unreasonable count instead of returning nothing", () => {
    const brief = buildMarketingBrief(signals());
    expect(composeFallbackCampaigns(brief, signals(), 0).length).toBeGreaterThanOrEqual(1);
  });
});

describe("buildPostShareCopy", () => {
  const post = {
    id: "post_1",
    title: "Kenya's grid adds solar",
    slug: "kenya-grid-solar",
    excerpt: "    A 40MW plant came online this week.   ",
    categoryName: "Energy",
  };

  it("attributes the link so the channel that carried it is measurable", () => {
    const copy = buildPostShareCopy(post, { origin: "https://connectplus.test" });
    expect(copy.link).toContain("utm_source=auto_share");
    expect(copy.link).toContain("utm_medium=social");
    expect(copy.link).toContain("utm_campaign=new_story");
    expect(copy.link.startsWith("https://connectplus.test/article/kenya-grid-solar")).toBe(true);
  });

  it("leads with the headline and collapses the excerpt to one line", () => {
    const copy = buildPostShareCopy(post, { origin: "https://connectplus.test" });
    expect(copy.message.startsWith("Kenya's grid adds solar")).toBe(true);
    expect(copy.message).toContain("A 40MW plant came online this week.");
    expect(copy.message).not.toContain("  ");
  });

  it("carries the story's category as a hashtag alongside the brand ones", () => {
    const copy = buildPostShareCopy(post, { origin: "https://connectplus.test", hashtags: ["Kenya"] });
    expect(copy.hashtags.map((t) => t.toLowerCase())).toContain("energy");
    expect(copy.hashtags.map((t) => t.toLowerCase())).toContain("kenya");
  });

  it("still writes a share when the story has no excerpt", () => {
    const copy = buildPostShareCopy({ ...post, excerpt: null }, { origin: "https://connectplus.test" });
    expect(copy.message).toContain("New on connectPlus: Kenya's grid adds solar");
  });
});
