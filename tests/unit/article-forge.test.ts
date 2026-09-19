import { describe, expect, it } from "vitest";
import {
  assembleArticle,
  clampTargetWords,
  completionIssues,
  continuePrompt,
  countWords,
  DEFAULT_ARTICLE_WORDS,
  forgeArticle,
  isArticleRequest,
  isComplete,
  joinChunks,
  parseArticleOutline,
  planArticle,
  type ArticleAsk,
} from "@/lib/article-forge";

const COMPLETE = "The county has pledged to rebuild the market before the long rains.";

describe("what counts as a request for an article", () => {
  it("recognises a writing verb plus a publishing noun", () => {
    const request = isArticleRequest("Write a full SEO article about the future of fintech in Nairobi");
    expect(request).not.toBeNull();
    expect(request!.topic).toMatch(/future of fintech in Nairobi/i);
    expect(request!.targetWords).toBe(DEFAULT_ARTICLE_WORDS);
  });

  it("reads a length out of the prompt", () => {
    expect(isArticleRequest("draft an 800 word post on boda boda safety")!.targetWords).toBe(800);
    expect(isArticleRequest("write a 200 word piece about muratina")!.targetWords).toBe(400); // floored
  });

  it("leaves an edit instruction alone", () => {
    // "Tighten this paragraph" is a rewrite, not a commission: routing it to the
    // forge would spend a dozen calls turning one sentence into an outline.
    expect(isArticleRequest("tighten this paragraph")).toBeNull();
    expect(isArticleRequest("fix the grammar here")).toBeNull();
    expect(isArticleRequest("write")).toBeNull();
    expect(isArticleRequest("write about the market")).toBeNull();
  });
});

describe("completion detection", () => {
  it("accepts a finished sentence", () => {
    expect(completionIssues(COMPLETE)).toEqual([]);
    expect(isComplete(COMPLETE)).toBe(true);
  });

  it("catches the ways a completion is actually cut", () => {
    expect(completionIssues("The market in Kibera burned down and")).toContain("it stops on a connecting word");
    expect(completionIssues("The market in Kibera burned down last month")).toContain("it has no closing punctuation");
    expect(completionIssues("Here is the plan:")).toContain("it ends on a dangling mark");
    expect(completionIssues("```js\nconst a = 1;")).toContain("an unclosed code block");
    expect(completionIssues("That is **almost bold")).toContain("unbalanced bold markers");
    expect(completionIssues("")).toContain("no text returned");
  });

  it("does not punish a paragraph that simply ends on a bracket", () => {
    expect(isComplete("The figure (per the county) is disputed.)")).toBe(true);
  });
});

describe("the deterministic plan", () => {
  it("is a usable article, not a placeholder", () => {
    const plan = planArticle({ topic: "the Kibera market fire", category: "News", targetWords: 1_200 });
    expect(plan.sections.length).toBeGreaterThanOrEqual(4);
    expect(plan.title).toBe("The Kibera Market Fire");
    expect(plan.metaDescription.length).toBeLessThanOrEqual(160);
    expect(plan.tags.length).toBeGreaterThan(0);
    expect(plan.tags.every((t) => t === t.toLowerCase() && !t.includes(" "))).toBe(true);
    // The per-section budgets have to add up to something like the article.
    const budgeted = plan.sections.reduce((sum, s) => sum + s.targetWords, 0);
    expect(budgeted).toBeGreaterThan(600);
    expect(budgeted).toBeLessThanOrEqual(1_200);
  });

  it("bounds the length a caller may ask for", () => {
    expect(clampTargetWords(50)).toBe(400);
    expect(clampTargetWords(99_000)).toBe(3_000);
    expect(clampTargetWords("nonsense")).toBe(DEFAULT_ARTICLE_WORDS);
  });
});

describe("reading a model's outline", () => {
  const outline = JSON.stringify({
    title: "Nairobi's Bus Rapid Transit finally moves",
    metaDescription: "After a decade of promises, Nairobi's BRT lines are being built. Here is what changes for commuters.",
    hook: "Open on a commuter who has made the same trip for eleven years.",
    sections: [
      { heading: "What was announced", goal: "The announcement, the date and the money." },
      { heading: "Why it stalled", goal: "The procurement disputes." },
      { heading: "What it costs riders", goal: "Fares and travel time." },
    ],
    faq: ["When do the buses start?", "Will fares rise?"],
    tags: ["Nairobi", "Transport", "BRT"],
  });

  it("parses an outline wrapped in prose", () => {
    const plan = parseArticleOutline(`Sure, here you go:\n\n${outline}\n\nLet me know!`, { topic: "Nairobi BRT", targetWords: 900 });
    expect(plan).not.toBeNull();
    expect(plan!.refined).toBe(true);
    expect(plan!.sections.map((s) => s.heading)).toEqual(["What was announced", "Why it stalled", "What it costs riders"]);
    expect(plan!.tags).toEqual(["nairobi", "transport", "brt"]);
    expect(plan!.faq).toHaveLength(2);
    // The budget is arithmetic we own, not something the model gets to set.
    expect(plan!.sections.every((s) => s.targetWords >= 90)).toBe(true);
  });

  it("falls back rather than accepting a holed plan", () => {
    expect(parseArticleOutline("no json here", { topic: "x" })).toBeNull();
    expect(parseArticleOutline('{"sections":[{"heading":"Only one"}]}', { topic: "x" })).toBeNull();
    expect(parseArticleOutline('{"sections":"nope"}', { topic: "x" })).toBeNull();
  });
});

describe("assembly", () => {
  const plan = planArticle({ topic: "the Kibera market fire", targetWords: 600 });

  it("takes its headings from the plan and reports what never arrived", () => {
    const parts = ["The market burned on a Sunday.", "## What actually happened\nThe fire started at dusk.", "", ...plan.sections.slice(2).map(() => "")];
    const result = assembleArticle(plan, parts);
    expect(result.markdown).toContain("# The Kibera Market Fire");
    expect(result.markdown).toContain(`## ${plan.sections[0]!.heading}`);
    // The heading the model repeated is not printed twice.
    expect(result.markdown.match(/What actually happened/g) ?? []).toHaveLength(0);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.words).toBeGreaterThan(5);
  });

  it("counts words the way a writer does", () => {
    expect(countWords("## A heading\n\nOne two three.")).toBe(5);
  });

  it("joins a repair onto the sentence it continues", () => {
    expect(joinChunks("The market burned and", "the traders are still waiting.")).toBe(
      "The market burned and the traders are still waiting."
    );
    expect(joinChunks("The market burned.", "The traders are still waiting.")).toBe(
      "The market burned.\n\nThe traders are still waiting."
    );
  });
});

describe("the forge finishes what it starts", () => {
  /** An outline the forge can plan against, so the fake model controls the shape. */
  const outlineReply = JSON.stringify({
    title: "Kibera market rebuild",
    metaDescription: "Traders are waiting on a promise.",
    hook: "Open with the vendor who lost everything.",
    sections: [
      { heading: "What happened", goal: "The fire and its cost." },
      { heading: "What was promised", goal: "The county's pledge." },
      { heading: "What happens next", goal: "The timeline." },
    ],
    faq: ["When will the market reopen?"],
    tags: ["kibera", "nairobi"],
  });

  it("repairs a cut section instead of shipping it", async () => {
    let partCalls = 0;
    const ask: ArticleAsk = async ({ kind }) => {
      if (kind === "article-outline") return outlineReply;
      if (kind === "article-continue") return "so the traders can return well before the rains end.";
      partCalls += 1;
      // Every section comes back cut — the old failure, on purpose.
      return `The county said the work would begin this month and`;
    };

    const forged = await forgeArticle({ topic: "the Kibera market fire", targetWords: 600 }, ask);

    expect(forged.degraded).toBe(false);
    expect(forged.missing).toEqual([]);
    expect(partCalls).toBeGreaterThan(1);
    expect(forged.repairs.some((r) => r.includes("repaired after"))).toBe(true);
    // Every section body is present and the article reads finished.
    for (const section of forged.plan.sections) {
      expect(forged.markdown).toContain(`## ${section.heading}`);
    }
    expect(isComplete(forged.markdown)).toBe(true);
    expect(forged.markdown).toContain("## Frequently asked questions");
    expect(forged.words).toBeGreaterThan(20);
  });

  it("reports a section it could never complete rather than hiding it", async () => {
    const ask: ArticleAsk = async ({ kind }) => {
      if (kind === "article-outline") return outlineReply;
      if (kind === "article-continue") return "and then it stopped again, and"; // still cut
      return "The county said the work would begin this month and";
    };

    const forged = await forgeArticle({ topic: "the Kibera market fire", targetWords: 600 }, ask);
    expect(forged.repairs.length).toBeGreaterThan(0);
    expect(forged.repairs.some((r) => r.includes("still"))).toBe(true);
  });

  it("hands back the structured plan when no model is configured", async () => {
    const forged = await forgeArticle({ topic: "the Kibera market fire", targetWords: 600 }, async () => null);

    expect(forged.degraded).toBe(true);
    expect(forged.markdown).toContain("# The Kibera Market Fire");
    for (const section of forged.plan.sections) {
      expect(forged.markdown).toContain(`## ${section.heading}`);
    }
    expect(forged.repairs[0]).toMatch(/No writing model is configured/i);
    expect(forged.excerpt.length).toBeGreaterThan(10);
    expect(forged.markdown).toContain("## Frequently asked questions");
  });

  it("asks for the continuation of the section that was cut", () => {
    const plan = planArticle({ topic: "anything", targetWords: 600 });
    const prompt = continuePrompt(plan, 1, "The market burned and", ["it stops on a connecting word"]);
    expect(prompt).toContain(plan.sections[1]!.heading);
    expect(prompt).toContain("it stops on a connecting word");
    expect(prompt).toContain("Do not repeat any earlier sentence");
  });
});
