import { describe, expect, it } from "vitest";
import { classifyFeedItem, evaluateFeedItem, hintCategory } from "@/lib/rss-intelligence";

const BODY =
  "The announcement was made during a briefing in Nairobi, where officials said the programme " +
  "will run for the next three years and cover all 47 counties before the end of the financial year.";

describe("classifyFeedItem", () => {
  it("files a money story under Business", () => {
    const guess = classifyFeedItem({
      title: "Treasury cuts spending as shilling strengthens against the dollar",
      summary: BODY,
    });
    expect(guess?.slug).toBe("business");
    expect(guess?.confident).toBe(true);
  });

  it("files a telco product story under Technology", () => {
    const guess = classifyFeedItem({
      title: "Safaricom launches new M-Pesa feature for small traders",
      summary: BODY,
    });
    expect(guess?.slug).toBe("technology");
  });

  it("files a match report under Sports", () => {
    const guess = classifyFeedItem({
      title: "Harambee Stars coach names squad for AFCON qualifier",
      summary: BODY,
    });
    expect(guess?.slug).toBe("sports");
  });

  it("files politics under News", () => {
    const guess = classifyFeedItem({
      title: "Ruto appoints new cabinet secretaries in mini reshuffle",
      summary: BODY,
    });
    expect(guess?.slug).toBe("news");
  });

  it("files celebrity coverage under Culture", () => {
    const guess = classifyFeedItem({
      title: "Celebrity couple's wedding photos break the internet",
      summary: BODY,
    });
    expect(guess?.slug).toBe("culture");
  });

  it("files a wildlife destination under Travel", () => {
    const guess = classifyFeedItem({
      title: "Maasai Mara lodge named best safari destination in Africa",
      summary: BODY,
    });
    expect(guess?.slug).toBe("travel");
  });

  it("files a recipe under Food", () => {
    const guess = classifyFeedItem({
      title: "How to make the perfect ugali: a step-by-step recipe",
      summary: BODY,
    });
    expect(guess?.slug).toBe("food");
  });

  it("files a hospital story under Lifestyle", () => {
    const guess = classifyFeedItem({
      title: "Kenyatta National Hospital opens new cancer treatment wing",
      summary: BODY,
    });
    expect(guess?.slug).toBe("lifestyle");
  });

  it("falls back to the feed's beat when the item itself is ambiguous", () => {
    const guess = classifyFeedItem({
      title: "Morning briefing: what you need to know today",
      summary: "A roundup of the day's developments from our newsroom.",
      feedCategory: "News",
    });
    expect(guess?.slug).toBe("news");
    expect(guess?.confident).toBe(false);
  });

  it("returns null when there is nothing to judge", () => {
    expect(classifyFeedItem({ title: "" })).toBeNull();
  });
});

describe("hintCategory", () => {
  it("maps media-house beats onto the platform taxonomy", () => {
    expect(hintCategory("News")?.slug).toBe("news");
    expect(hintCategory("Entertainment")?.slug).toBe("culture");
    expect(hintCategory("Tech")?.slug).toBe("technology");
    expect(hintCategory("Sports")?.slug).toBe("sports");
  });

  it("returns null for an unknown beat", () => {
    expect(hintCategory("Obituaries")).toBeNull();
    expect(hintCategory(null)).toBeNull();
  });
});

describe("evaluateFeedItem", () => {
  const good = {
    title: "Nairobi county unveils new commuter rail timetable for the city",
    url: "https://example.co.ke/news/nairobi-commuter-rail-timetable",
    summary: BODY,
  };

  it("keeps a real article and tags it with a category", () => {
    const verdict = evaluateFeedItem(good);
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toBeUndefined();
    expect(verdict.category).not.toBeNull();
    expect(verdict.moderation.suggested).toBe("APPROVED");
  });

  it("drops items with no usable headline", () => {
    const verdict = evaluateFeedItem({ ...good, title: "Breaking" });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toBe("title-too-short");
  });

  it("drops summary-only stubs the feed uses for 'read more' links", () => {
    const verdict = evaluateFeedItem({ ...good, summary: "Read more on our site.", content: "" });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toBe("no-article-body");
  });

  it("drops tag and category index pages", () => {
    const verdict = evaluateFeedItem({ ...good, url: "https://example.co.ke/tag/kenya/" });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toBe("index-page");
  });

  it("drops classifieds, tenders and gambling promos", () => {
    expect(
      evaluateFeedItem({ ...good, summary: `${BODY} Tenders: supply of stationery.` }).reason
    ).toBe("classifieds-tender");
    expect(
      evaluateFeedItem({ ...good, title: "Deposit today and grab a free bet bonus", summary: BODY }).reason
    ).toBe("gambling-promo");
    expect(
      evaluateFeedItem({ ...good, summary: `${BODY} Sponsored content by our partner.` }).reason
    ).toBe("advertorial");
  });

  it("runs the moderation scanner instead of waving imports through", () => {
    const toxic = evaluateFeedItem({
      ...good,
      title: "Angry mob storms the office in Nairobi county",
      summary: `${BODY} You are an idiot and a stupid loser, everyone says you fucking suck and should shut up.`,
    });
    expect(toxic.keep).toBe(false);
    expect(toxic.reason).toBe("moderation-rejected");

    const borderline = evaluateFeedItem({
      ...good,
      summary: `${BODY} The alleged scam saw investors lose money in a crypto giveaway.`,
    });
    expect(borderline.keep).toBe(true);
    expect(borderline.moderation.suggested).toBe("FLAGGED");
  });
});
