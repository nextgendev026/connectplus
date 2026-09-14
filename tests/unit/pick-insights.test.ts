import { describe, expect, it } from "vitest";
import { explainPick, humaniseNote } from "@/lib/pick-insights";

const match = {
  homeTeam: "Gor Mahia",
  awayTeam: "AFC Leopards",
  oddsHome: 1.85,
  oddsDraw: 3.4,
  oddsAway: 4.2,
};

describe("explainPick", () => {
  it("says what the pick is and how sure the model is, in one sentence", () => {
    const insight = explainPick({
      market: "1X2",
      selection: "Gor Mahia win",
      confidence: 0.62,
      valueEdge: 4.2,
      homeWinPct: 62,
      drawPct: 21,
      awayWinPct: 17,
      expectedHomeGoals: 1.7,
      expectedAwayGoals: 0.9,
      rationale: "Poisson model: xG 1.70–0.90.",
      match,
    });

    expect(insight.marketPlain).toBe("Who wins");
    expect(insight.belief).toBe(62);
    expect(insight.tier.label).toBe("Good call");
    expect(insight.summary).toContain("Gor Mahia win");
    expect(insight.summary).toContain("62%");
    expect(insight.summary).not.toMatch(/poisson|xg|implied|pp\b/i);
  });

  it("names the reasons in the order a reader wants them", () => {
    const insight = explainPick({
      market: "over-under",
      selection: "Over 2.5 goals",
      confidence: 0.58,
      valueEdge: null,
      expectedHomeGoals: 1.6,
      expectedAwayGoals: 1.2,
      rationale: "Poisson model: xG 1.60–1.20. Real form: Gor Mahia WWDWL. 3 recent head-to-head meetings factored in.",
      match,
    });

    expect(insight.reasons.map((r) => r.icon)).toEqual(["goals", "bookies", "form"]);
    expect(insight.reasons[0]!.detail).toContain("2.8 goals");
    expect(insight.reasons[1]!.detail).toContain("Gor Mahia");
    expect(insight.reasons[2]!.detail).toContain("WWDWL");
    // Form arrives through the audit trail, so it must arrive without its jargon.
    expect(insight.reasons[2]!.detail).not.toMatch(/xG|Poisson|Hive/i);
  });

  it("calls out a price that is not in the reader's favour", () => {
    const insight = explainPick({
      market: "1X2",
      selection: "AFC Leopards win",
      confidence: 0.4,
      valueEdge: -6.4,
      homeWinPct: 55,
      drawPct: 20,
      awayWinPct: 25,
      match,
    });

    expect(insight.reasons.some((r) => r.icon === "value" && /shorter than we do/i.test(r.detail))).toBe(true);
    expect(insight.caution).toMatch(/shorter than our own number/i);
  });

  it("is honest that an exact scoreline is a long shot", () => {
    const insight = explainPick({
      market: "correct-score",
      selection: "2-1",
      confidence: 0.14,
      match,
    });

    expect(insight.marketPlain).toBe("Exact score");
    expect(insight.tier.tone).toBe("longshot");
    expect(insight.caution).toMatch(/hardest market/i);
    expect(insight.summary).toMatch(/bit of fun/i);
  });

  it("warns when the favourite leaves no room for profit", () => {
    const insight = explainPick({
      market: "1X2",
      selection: "Gor Mahia win",
      confidence: 0.7,
      match: { ...match, oddsHome: 1.28 },
    });
    expect(insight.caution).toMatch(/very little room for profit/i);
  });

  it("never shows the audit trail raw", () => {
    const insight = explainPick({
      market: "btts",
      selection: "Both teams to score",
      confidence: 0.61,
      expectedHomeGoals: 1.3,
      expectedAwayGoals: 1.1,
      rationale:
        "Poisson model: xG 1.30–1.10. Modelled chance both sides score: 61%, so the lean is yes (61%). Hive prior: 58% accuracy across 24 settled Kenya Premier League picks.",
      match,
    });

    expect(insight.note).toContain("Our goals model expects 1.30–1.10 goals");
    expect(insight.note).toContain("Our record on picks like this: 58% across 24 settled Kenya Premier League picks");
    expect(insight.reasons.map((r) => r.icon)).toContain("record");
  });
});

describe("humaniseNote", () => {
  it("translates the edge sentence without changing the number", () => {
    expect(humaniseNote("Model is 7.3pp above the market's implied price.")).toBe(
      "We rate it 7.3 points higher than the bookies' price."
    );
    expect(humaniseNote("Market is 4.1pp shorter than the model — thin value.")).toBe(
      "The bookies price it 4.1 points shorter than we do — little value there."
    );
  });

  it("explains an empty prior instead of printing model-speak at the reader", () => {
    const out = humaniseNote("Hive prior: not enough settled Serie A picks yet, leaning on the base model.");
    expect(out).toContain("not settled enough Serie A picks");
    expect(out).not.toContain("Hive prior");
  });

  it("leaves anything it does not recognise exactly as written", () => {
    expect(humaniseNote("Something the model adds later.")).toBe("Something the model adds later.");
    expect(humaniseNote("")).toBe("");
  });
});
