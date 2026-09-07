import { describe, expect, it, vi } from "vitest";

// The ranker reads the user's preference vector and post embeddings for
// non-control variants — stub the DB so the test runs without a connection.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    userPreference: { findUnique: vi.fn(async () => null) },
    postEmbedding: { findMany: vi.fn(async () => []) },
  },
}));

import {
  getExperimentVariant,
  getFeedRankVariant,
  FEED_RANK_VARIANTS,
} from "@/lib/experiments";
import { rankFeed } from "@/lib/feed-ranker";
import { enhanceText } from "@/lib/neural-generate";

describe("experiments (Phase 3 A/B framework)", () => {
  it("assigns a deterministic variant per user", () => {
    const a = getExperimentVariant("user-1", "feed-rank", FEED_RANK_VARIANTS);
    const b = getExperimentVariant("user-1", "feed-rank", FEED_RANK_VARIANTS);
    const c = getExperimentVariant("user-2", "feed-rank", FEED_RANK_VARIANTS);
    expect(a).toBe(b);
    expect(FEED_RANK_VARIANTS).toContain(a);
    expect(FEED_RANK_VARIANTS).toContain(c);
  });

  it("spreads users across variants", () => {
    const seen = new Set(
      Array.from({ length: 60 }, (_, i) =>
        getFeedRankVariant(`u${i}`)
      )
    );
    expect(seen.size).toBeGreaterThan(1);
  });

  it("falls back to control for anonymous users", () => {
    expect(getFeedRankVariant(null)).toBe("control");
    expect(getFeedRankVariant(undefined)).toBe("control");
  });
});

describe("adaptive feed ranker (Phase 1)", () => {
  const makePost = (id: string, createdAt: Date, views: number) => ({
    id,
    title: id,
    excerpt: null,
    content: id,
    slug: id,
    coverImage: null,
    createdAt,
    viewCount: views,
    _count: { comments: 0, likes: 0 },
  });

  it("preserves pool order for control / anonymous users", async () => {
    // Control = the caller's pool order (recency), untouched.
    const posts = [
      makePost("c", new Date(Date.now() - 3_600_000), 1),
      makePost("b", new Date(Date.now() - 2 * 3_600_000), 1),
      makePost("a", new Date(Date.now() - 3 * 3_600_000), 1),
    ];
    const { posts: ranked, variant } = await rankFeed(posts, null);
    expect(variant).toBe("control");
    expect(ranked.map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("ranks deterministically and never drops posts", async () => {
    const posts = [
      makePost("a", new Date(Date.now() - 100 * 3_600_000), 100),
      makePost("b", new Date(Date.now() - 3_600_000), 1),
      makePost("c", new Date(Date.now() - 2 * 3_600_000), 1),
    ];
    const first = await rankFeed(posts, "u-1");
    const second = await rankFeed(posts, "u-1");
    expect(first.posts.map((p) => p.id)).toEqual(second.posts.map((p) => p.id));
    expect(new Set(first.posts.map((p) => p.id))).toEqual(new Set(posts.map((p) => p.id)));
    expect(FEED_RANK_VARIANTS).toContain(first.variant);
  });
});

describe("content enhancement (Phase 2/4)", () => {
  it("scores a clean draft highly", () => {
    const clean =
      "Kenya's chip designers are racing to ship. The new fab campus employs four hundred engineers. " +
      "They target power-efficient silicon for the region. Export orders tripled this quarter.";
    const r = enhanceText(clean);
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(["A", "B"]).toContain(r.grade);
  });

  it("flags long sentences, fillers and weak openers", () => {
    const messy =
      "In today's article we are going to talk about a really really long run-on sentence that keeps going and going " +
      "and never seems to stop because the author wrote one enormous sentence without any punctuation whatsoever " +
      "which makes it very hard to read and follow along with the main idea being communicated to the audience. " +
      "It was decided that the policy would be changed by the committee. Maybe perhaps it is just me.";
    const r = enhanceText(messy);
    expect(r.score).toBeLessThan(75);
    const kinds = r.suggestions.map((s) => s.kind);
    expect(kinds).toContain("long-sentence");
    expect(kinds).toContain("filler-words");
    expect(kinds).toContain("weak-hook");
    expect(kinds).toContain("passive-voice");
    expect(kinds).toContain("hedging");
  });

  it("returns readable stats", () => {
    const r = enhanceText("One sentence here. Another sentence there. A third one.");
    expect(r.readability.sentences).toBe(3);
    expect(r.readability.words).toBeGreaterThan(0);
    expect(r.suggestions).toEqual([]);
  });
});