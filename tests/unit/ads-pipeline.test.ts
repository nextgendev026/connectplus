import { describe, expect, it } from "vitest";
import {
  AD_SLOTS,
  AD_SLOT_HINTS,
  AD_SLOT_LABELS,
  DEFAULT_FREQUENCY_CAP,
  capKey,
  deviceFromWidth,
  eligibleCreatives,
  isAdSlot,
  matchesTargeting,
  normalizeDeviceList,
  normalizeFrequencyCap,
  normalizeTargetList,
  parseTargetList,
  pickWeighted,
  reservedHeightForSizes,
  selectCreative,
  shouldRenderAdFrame,
  shouldReserveSlotHeight,
  slotAllowsDevice,
  slotHint,
  slotMinHeight,
  stableSeed,
  type SelectableCreative,
  type SelectionContext,
} from "../../src/lib/ad-selection";
import { splitForInlineAd } from "../../src/lib/article-body";

const creative = (over: Partial<SelectableCreative> = {}): SelectableCreative => ({
  id: "ad-1",
  weight: 1,
  categories: null,
  devices: null,
  frequencyCap: null,
  ...over,
});

const ctx = (over: Partial<SelectionContext> = {}): SelectionContext => ({
  visitorKey: "visitor-a",
  ...over,
});

describe("ad placement catalogue", () => {
  it("labels and sizes every slot it declares", () => {
    // This is the check that was missing: the console kept its own hardcoded
    // list, so slots the app could render were not selectable anywhere and
    // nothing failed. A catalogue entry without a label or a height is the same
    // class of bug.
    for (const slot of AD_SLOTS) {
      expect(AD_SLOT_LABELS[slot], `no label for ${slot}`).toBeTruthy();
      expect(AD_SLOT_HINTS[slot], `no hint for ${slot}`).toBeTruthy();
      expect(AD_SLOT_HINTS[slot].minHeight).toBeGreaterThan(0);
    }
  });

  it("rejects a slot name that is not in the catalogue", () => {
    expect(isAdSlot("feed-inline")).toBe(true);
    expect(isAdSlot("ads/slots?slot=../../etc")).toBe(false);
    expect(isAdSlot("")).toBe(false);
  });

  it("reserves no space for an unknown slot", () => {
    expect(slotMinHeight("not-a-slot")).toBe(0);
    expect(slotHint("not-a-slot").device).toBeUndefined();
  });
});

describe("device targeting", () => {
  it("classifies widths at the layout breakpoints", () => {
    expect(deviceFromWidth(390)).toBe("mobile");
    expect(deviceFromWidth(768)).toBe("tablet");
    expect(deviceFromWidth(1440)).toBe("desktop");
  });

  it("keeps desktop-only formats off phones and mobile-only formats off desktops", () => {
    expect(slotAllowsDevice("article-sticky", "mobile")).toBe(false);
    expect(slotAllowsDevice("article-sticky", "desktop")).toBe(true);
    expect(slotAllowsDevice("global-anchor", "mobile")).toBe(true);
    expect(slotAllowsDevice("global-anchor", "desktop")).toBe(false);
    expect(slotAllowsDevice("feed-inline", "mobile")).toBe(true);
  });

  it("drops unrecognised devices rather than letting a campaign serve nowhere", () => {
    // A typo must widen the campaign, never silently stop it: an unknown device
    // value can never match, so keeping it would kill the placement everywhere.
    expect(normalizeDeviceList("mobile, mobil, tablet")).toBe('["mobile","tablet"]');
    expect(normalizeDeviceList("nonsense")).toBeNull();
    expect(normalizeDeviceList("")).toBeNull();
  });
});

describe("targeting", () => {
  it("serves an untargeted campaign everywhere", () => {
    // Every campaign created before these fields existed means "everywhere".
    expect(matchesTargeting(creative(), { categories: ["technology"], device: "mobile" })).toBe(true);
    expect(matchesTargeting(creative(), {})).toBe(true);
  });

  it("matches a categorised campaign only on a page that names the category", () => {
    const ad = creative({ categories: '["technology"]' });
    expect(matchesTargeting(ad, { categories: ["technology"] })).toBe(true);
    expect(matchesTargeting(ad, { categories: ["Technology"] })).toBe(true);
    expect(matchesTargeting(ad, { categories: ["sports"] })).toBe(false);
  });

  it("stays eligible on an untagged page", () => {
    // An untagged page is not evidence that the campaign is irrelevant.
    expect(matchesTargeting(creative({ categories: '["technology"]' }), {})).toBe(true);
  });

  it("filters a pool down to what the page allows", () => {
    const pool = [
      creative({ id: "tech", categories: '["technology"]' }),
      creative({ id: "sport", categories: '["sports"]' }),
      creative({ id: "any" }),
    ];
    const eligible = eligibleCreatives(pool, ctx({ categories: ["sports"] }));
    expect(eligible.map((a) => a.id)).toEqual(["sport", "any"]);
  });

  it("parses a JSON array or a plain comma list, and normalises for storage", () => {
    expect(parseTargetList('["Technology","Business"]')).toEqual(["technology", "business"]);
    expect(parseTargetList("Technology, Business")).toEqual(["technology", "business"]);
    expect(parseTargetList("")).toEqual([]);
    expect(parseTargetList("[not json")).toEqual([]);
    expect(normalizeTargetList("technology, business")).toBe('["technology","business"]');
    expect(normalizeTargetList("  ")).toBeNull();
  });

  it("caps a frequency value and treats nonsense as uncapped", () => {
    expect(normalizeFrequencyCap(4)).toBe(4);
    expect(normalizeFrequencyCap("4")).toBe(4);
    expect(normalizeFrequencyCap(0)).toBeNull();
    expect(normalizeFrequencyCap(-3)).toBeNull();
    expect(normalizeFrequencyCap("abc")).toBeNull();
    expect(normalizeFrequencyCap(9999)).toBe(100);
  });
});

describe("rotation", () => {
  it("is deterministic for the same visitor and slot", () => {
    // A pick that changes on every render cannot be reconciled with the
    // impression it recorded — this is what `Math.random()` used to do.
    expect(stableSeed("visitor", "feed-inline", 3)).toBe(stableSeed("visitor", "feed-inline", 3));
    expect(stableSeed("visitor", "feed-inline", 3)).toBeGreaterThanOrEqual(0);
    expect(stableSeed("visitor", "feed-inline", 3)).toBeLessThan(1);
  });

  it("rotates between visitors and between slots", () => {
    expect(stableSeed("visitor-a", "feed-inline", 3)).not.toBe(
      stableSeed("visitor-b", "feed-inline", 3)
    );
    expect(stableSeed("visitor-a", "feed-inline", 3)).not.toBe(
      stableSeed("visitor-a", "article-top", 3)
    );
  });

  it("favours a heavier campaign over many visitors", () => {
    const pool = [creative({ id: "light", weight: 1 }), creative({ id: "heavy", weight: 9 })];
    let heavy = 0;
    for (let i = 0; i < 500; i++) {
      const picked = selectCreative(pool, ctx({ visitorKey: `visitor-${i}` }));
      if (picked?.id === "heavy") heavy++;
    }
    // 9:1 weighting, so roughly 450 of 500 — asserted loosely on purpose.
    expect(heavy).toBeGreaterThan(380);
    expect(heavy).toBeLessThan(500);
  });

  it("never returns a creative that is not in the pool", () => {
    const pool = [creative({ id: "a" }), creative({ id: "b" })];
    for (let i = 0; i < 100; i++) {
      expect(pool).toContain(selectCreative(pool, ctx({ visitorKey: `v${i}` })));
    }
    expect(selectCreative([], ctx())).toBeNull();
  });

  it("returns the only creative for every visitor", () => {
    const only = [creative({ id: "solo" })];
    for (let i = 0; i < 50; i++) {
      expect(selectCreative(only, ctx({ visitorKey: `v${i}` }))?.id).toBe("solo");
    }
  });

  it("picks nothing when every creative is outside the seed-weighted range", () => {
    expect(pickWeighted([], 0.5)).toBeNull();
    expect(pickWeighted([creative({ id: "a" })], 0.999)?.id).toBe("a");
  });
});

describe("frequency capping", () => {
  it("skips a creative at its cap and hands the decision back", () => {
    const pool = [creative({ id: "capped", frequencyCap: 2 })];
    expect(selectCreative(pool, ctx({ seenCounts: { capped: 1 } }))?.id).toBe("capped");
    expect(selectCreative(pool, ctx({ seenCounts: { capped: 2 } }))).toBeNull();
  });

  it("falls through to the other campaign rather than repeating a capped one", () => {
    const pool = [
      creative({ id: "tired", frequencyCap: 1 }),
      creative({ id: "fresh", frequencyCap: 5 }),
    ];
    for (let i = 0; i < 40; i++) {
      const picked = selectCreative(pool, ctx({ visitorKey: `v${i}`, seenCounts: { tired: 1, fresh: 0 } }));
      expect(picked?.id).toBe("fresh");
    }
  });

  it("applies a default cap when the campaign sets none", () => {
    const pool = [creative({ id: "default" })];
    expect(selectCreative(pool, ctx({ seenCounts: { default: DEFAULT_FREQUENCY_CAP - 1 } }))).not.toBeNull();
    expect(selectCreative(pool, ctx({ seenCounts: { default: DEFAULT_FREQUENCY_CAP } }))).toBeNull();
  });

  it("does not cap at all when the caller has no ledger", () => {
    const pool = [creative({ id: "x", frequencyCap: 1 })];
    expect(selectCreative(pool, ctx())?.id).toBe("x");
  });
});

describe("one creative per page", () => {
  it("skips a creative already placed elsewhere on the page", () => {
    const pool = [creative({ id: "shared" })];
    expect(selectCreative(pool, ctx({ excludeIds: ["shared"] }))).toBeNull();
  });

  it("still finds something when only part of the pool is excluded", () => {
    const pool = [creative({ id: "used" }), creative({ id: "unused" })];
    for (let i = 0; i < 30; i++) {
      expect(selectCreative(pool, ctx({ visitorKey: `v${i}`, excludeIds: ["used"] }))?.id).toBe("unused");
    }
  });

  it("keys the cap ledger by slot as well as creative", () => {
    expect(capKey("feed-inline", "ad-1")).toBe("feed-inline:ad-1");
    expect(capKey("article-top", "ad-1")).not.toBe(capKey("feed-inline", "ad-1"));
  });
});

describe("reserving the box", () => {
  it("reads the height out of a declared size list", () => {
    expect(reservedHeightForSizes("[[300,250],[728,90]]")).toBe(250);
    expect(reservedHeightForSizes("[[728,90]]")).toBe(90);
  });

  it("refuses to reserve space it cannot justify", () => {
    expect(reservedHeightForSizes(null)).toBeNull();
    expect(reservedHeightForSizes("")).toBeNull();
    expect(reservedHeightForSizes("not json")).toBeNull();
    expect(reservedHeightForSizes("[300,250]")).toBeNull();
    expect(reservedHeightForSizes("[[300,0]]")).toBeNull();
    expect(reservedHeightForSizes("[[300,99999]]")).toBeNull();
  });
});

describe("splitting an article for an in-content ad", () => {
  const paragraph = (n: number) =>
    `Paragraph ${n} ${"word ".repeat(60)}`.trim();

  it("leaves a body that is too short to interrupt alone", () => {
    expect(splitForInlineAd("Short. ".repeat(20), 400)).toBeNull();
    expect(splitForInlineAd("", 400)).toBeNull();
  });

  it("splits markdown at a blank line without losing a character", () => {
    const body = [paragraph(1), paragraph(2), paragraph(3), paragraph(4), paragraph(5), paragraph(6)].join(
      "\n\n"
    );
    const split = splitForInlineAd(body, 100);
    expect(split).not.toBeNull();
    // Nothing lost, nothing duplicated.
    expect(split!.lead + split!.rest).toBe(body);
    // Every block on both sides is a whole paragraph: the cut never lands inside
    // one, which is the failure the reader would actually see.
    for (const half of [split!.lead, split!.rest]) {
      for (const block of half.trim().split("\n\n")) {
        expect(block.startsWith("Paragraph ")).toBe(true);
      }
    }
  });

  it("never splits inside a fenced code block", () => {
    // A cut here would leave an unterminated fence in the lead and a stray
    // closing fence in the rest, which renders as two broken code blocks.
    const code = ["```js", "const a = 1;", "", "const b = 2;", "```"].join("\n");
    const body = [paragraph(1), code, paragraph(2), paragraph(3)].join("\n\n");
    const split = splitForInlineAd(body, 50);
    expect(split).not.toBeNull();
    const fences = (split!.lead.match(/```/g) ?? []).length;
    expect(fences % 2).toBe(0);
    expect(split!.lead + split!.rest).toBe(body);
  });

  it("splits HTML at a block boundary", () => {
    const body = Array.from({ length: 8 }, (_, i) => `<p>${paragraph(i + 1)}</p>`).join("");
    const split = splitForInlineAd(body, 100);
    expect(split).not.toBeNull();
    expect(split!.lead.endsWith("</p>")).toBe(true);
    expect(split!.lead + split!.rest).toBe(body);
  });

  it("keeps the cut inside the middle half of the piece", () => {
    const body = Array.from({ length: 20 }, (_, i) => paragraph(i + 1)).join("\n\n");
    const split = splitForInlineAd(body, 50)!;
    const ratio = split.lead.length / body.length;
    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(0.8);
  });

  it("gives up rather than splitting at a bad boundary", () => {
    // One paragraph cannot be split at all: there is no block boundary to use.
    expect(splitForInlineAd(paragraph(1).repeat(30), 10)).toBeNull();
  });
});

/**
 * Whether an unfilled placement occupies space, or disappears.
 *
 * These are the two decisions behind "only the ad placeholder is visible" — a
 * hollow reserved box where an advertisement should be. Both were wrong, and both
 * were wrong in the same direction: the frame outlived its reason to exist.
 */
describe("reserving height before the answer is known", () => {
  it("holds space while the resolver has not answered yet", () => {
    // The layout-stability case the reservation exists for: a late creative must
    // not shove the paragraph a reader is mid-sentence through down the screen.
    expect(shouldReserveSlotHeight(false, "feed-inline")).toBe(true);
  });

  it("occupies nothing once the resolver has answered", () => {
    // The regression. `resolution ? undefined : slotMinHeight(slot)` cannot tell
    // "not asked yet" from "asked, and there is nothing", so a slot with no
    // campaign held its full height open for the life of the page.
    expect(shouldReserveSlotHeight(true, "feed-inline")).toBe(false);
  });

  it("never reserves for a fixed anchor slot", () => {
    // `global-anchor` is positioned against the viewport, so it cannot shift
    // content whenever it appears — there is no stability to buy, and reserving
    // 64px for it pins an empty bar to the bottom of every page on mobile.
    expect(shouldReserveSlotHeight(false, "global-anchor")).toBe(false);
    expect(slotHint("global-anchor").anchor).toBe(true);
  });

  it("still reserves for ordinary slots that are not anchors", () => {
    for (const slot of AD_SLOTS) {
      if (slotHint(slot).anchor) continue;
      expect(shouldReserveSlotHeight(false, slot), slot).toBe(true);
    }
  });
});

describe("whether an unfilled frame is rendered", () => {
  it("renders the frame before the browser can choose", () => {
    // The server cannot know which reader this is, so the first render has
    // nothing to show and must hold the space rather than jump.
    expect(shouldRenderAdFrame(false, false)).toBe(true);
  });

  it("renders once something is filling it", () => {
    expect(shouldRenderAdFrame(true, true)).toBe(true);
    expect(shouldRenderAdFrame(false, true)).toBe(true);
  });

  it("disappears when the browser has answered and picked nothing", () => {
    // The daily frequency cap is the case that produces this in the wild: a
    // campaign capped at three impressions runs out for a reader who has been on
    // the site a while, and every placement after that used to keep drawing its
    // empty bordered box with a "Sponsored" badge and no creative in it.
    expect(shouldRenderAdFrame(true, false)).toBe(false);
  });

  it("agrees with the cap that produces the empty frame", () => {
    // Ties the two modules together: a creative at its cap is filtered out of the
    // pool, so `filling` is false, so the frame must not render. Stated as a test
    // because the coupling is the whole point and nothing else asserts it.
    const capped = creative({ id: "ad-capped", frequencyCap: 3 });
    const picked = selectCreative([capped], {
      visitorKey: "reader-1",
      seenCounts: { "ad-capped": 3 },
    });
    expect(picked).toBeNull();
    expect(shouldRenderAdFrame(true, picked !== null)).toBe(false);
  });

  it("keeps rendering when a capped creative gives way to another", () => {
    // The cap must not empty the frame when a second campaign is available to
    // rotate into it — that would trade an empty box for a lost impression.
    const capped = creative({ id: "ad-capped", frequencyCap: 1 });
    const fresh = creative({ id: "ad-fresh", frequencyCap: 5 });
    const picked = selectCreative([capped, fresh], {
      visitorKey: "reader-1",
      seenCounts: { "ad-capped": 1, "ad-fresh": 0 },
    });
    expect(picked?.id).toBe("ad-fresh");
    expect(shouldRenderAdFrame(true, picked !== null)).toBe(true);
  });
});
