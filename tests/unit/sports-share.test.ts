import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({
  getSiteConfig: vi.fn(async () => ({
    siteName: "connectPlus",
    siteUrl: "https://connectplus.test/",
    ogImage: "/og-default.png",
  })),
}));

const { sportsShareCard } = await import("@/lib/seo");

const summary = {
  livePicks: 12,
  settled: 480,
  won: 293,
  accuracy: 61,
  pick: {
    fixture: "Arsenal vs Chelsea",
    selection: "Over 2.5 goals",
    competition: "Premier League",
    confidence: 61,
    kickoff: "2026-09-17T18:00:00.000Z",
  },
};

describe("tips share card", () => {
  it("describes the pick when the link names a fixture", async () => {
    const card = await sportsShareCard(summary, { matchId: "m_1" });
    expect(card.title).toContain("Arsenal vs Chelsea");
    expect(card.title).toContain("Over 2.5 goals");
    expect(card.title).toContain("61%");
    expect(card.canonical).toContain("/sports?tab=tips");
    expect(card.canonical).toContain("match=m_1");
    expect(card.type).toBe("website");
  });

  it("carries the model's record and the age disclaimer into the card", async () => {
    const card = await sportsShareCard(summary, { matchId: "m_1" });
    expect(card.description).toContain("61% across 480 settled picks");
    expect(card.description).toContain("not financial advice");
    expect(card.description.toLowerCase()).toContain("18+");
  });

  it("uses the sports artwork, absolutely addressed, not the square icon", async () => {
    const card = await sportsShareCard(summary);
    expect(card.image).toBe("https://connectplus.test/og-tips.png");
    expect(card.image).not.toContain("pwa-");
  });

  it("describes the board when no fixture is named", async () => {
    const card = await sportsShareCard({ ...summary, pick: null });
    expect(card.title).toContain("picks");
    expect(card.description).toContain("12 actionable picks");
    expect(card.description).toContain("61% across 480 settled picks");
  });

  it("stays honest before anything has settled", async () => {
    const card = await sportsShareCard({ livePicks: 3, settled: 0, won: 0, accuracy: null, pick: null });
    expect(card.description).not.toContain("settled picks");
    expect(card.description).toContain("3 actionable picks");
  });

  it("encodes a fixture id rather than pasting it raw", async () => {
    const card = await sportsShareCard({ ...summary, pick: null }, { matchId: "a b&c" });
    expect(card.canonical).toContain("match=a%20b%26c");
  });

  it("omits a provider competition code instead of printing it", async () => {
    const card = await sportsShareCard({
      ...summary,
      pick: { ...summary.pick, competition: null },
    });
    expect(card.description.startsWith("Every pick arrives")).toBe(true);
    expect(card.description).not.toContain("null");
  });

  it("never reports a syndication source, only our own tags", async () => {
    const card = await sportsShareCard(summary);
    expect(card.tags).toContain("Football");
    expect(card.author).toBeNull();
  });
});
