import { describe, expect, it } from "vitest";
import {
  polishText,
  continueText,
  buildOutline,
  composeDraft,
  stripInstruction,
  pickVariant,
} from "@/lib/neural-generate";

describe("writing brain — polishText", () => {
  it("cuts filler and hedging words", () => {
    const messy =
      "This is actually a really great story about Nairobi. I think the startup scene is kind of booming and very exciting.";
    const r = polishText(messy);
    expect(r.rewritten.toLowerCase()).not.toContain("actually");
    expect(r.rewritten.toLowerCase()).not.toContain("very exciting");
    expect(r.changes).toBeGreaterThan(0);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("splits marathon sentences", () => {
    const long =
      "The story of East African fintech is the story of a thousand small decisions made by founders and regulators and customers " +
      "who kept showing up and building despite the odds and that persistence is exactly what investors are starting to reward " +
      "across the region right now as the numbers finally begin to speak for themselves.";
    const r = polishText(long);
    const before = r.original.split(/\s+/).length;
    const after = r.rewritten.split(/\s+/).length;
    expect(r.rewritten).not.toBe(r.original);
    expect(after).toBeLessThanOrEqual(before);
    expect(r.notes.join(" ")).toMatch(/split/i);
  });

  it("leaves a clean draft untouched", () => {
    const clean = "Nairobi's engineers ship weekly. The new hub employs four hundred people.";
    const r = polishText(clean);
    expect(r.rewritten).toBe(r.original);
    expect(r.changes).toBe(0);
  });
});

describe("writing brain — continueText", () => {
  it("anchors the continuation to keywords from the draft", () => {
    const draft =
      "Kenyan agritech startups are connecting smallholder farmers directly to buyers. The new logistics network cuts middlemen and raises margins for everyone.";
    const r = continueText(draft);
    expect(r.continuation.length).toBeGreaterThan(80);
    expect(r.heading).toMatch(/^## /);
    const lower = r.continuation.toLowerCase();
    expect(lower).toMatch(/agritech|logistics|farmers|middlemen/);
  });

  it("produces different continuations for different drafts", () => {
    const a = continueText("Solar microgrids are lighting up rural schools across East Africa. Adoption doubled this year.");
    const b = continueText("Kampala's food scene is exploding with new restaurants every month. Chefs are going global.");
    expect(a.continuation).not.toBe(b.continuation);
  });
});

describe("writing brain — buildOutline", () => {
  it("returns an intro, sections and closing", () => {
    const o = buildOutline("digital currency regulation in Kenya");
    expect(o.intro.length).toBeGreaterThan(20);
    expect(o.sections.length).toBeGreaterThanOrEqual(4);
    expect(o.sections.every((s) => s.startsWith("## "))).toBe(true);
    expect(o.closing.length).toBeGreaterThan(20);
  });
});

describe("writing brain — composeDraft", () => {
  it("drafts a full post with headline and tags", () => {
    const { draft, headline, tags } = composeDraft("Rwanda smart city technology");
    expect(draft).toMatch(/^There is a quiet shift/);
    expect(draft.split("\n").length).toBeGreaterThan(6);
    expect(headline.length).toBeGreaterThan(10);
    expect(tags.length).toBeGreaterThanOrEqual(3);
  });

  it("produces different drafts for different topics", () => {
    const a = composeDraft("music festivals in Mombasa");
    const b = composeDraft("agriculture drones in Nigeria");
    expect(a.draft).not.toBe(b.draft);
    expect(a.headline).not.toBe(b.headline);
  });
});

describe("writing brain — instruction parsing", () => {
  it("strips common instruction prefixes", () => {
    expect(stripInstruction("rewrite this: Hello world text")).toBe("Hello world text");
    expect(stripInstruction("polish my draft — Nairobi fintech boom")).toBe("Nairobi fintech boom");
    expect(stripInstruction("write about coastal tourism")).toBe("coastal tourism");
    expect(stripInstruction("summarize this")).toBe("");
  });
});

describe("writing brain — pickVariant", () => {
  it("is deterministic per seed and varies across seeds", () => {
    const opts = ["a", "b", "c"];
    expect(pickVariant(opts, "same-seed")).toBe(pickVariant(opts, "same-seed"));
    expect(pickVariant(opts, "one")).not.toBe(pickVariant(opts, "another"));
  });
});