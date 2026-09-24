import { describe, expect, it } from "vitest";
import { toReadingsSummary } from "@/lib/chat-history";

/**
 * Reopening a saved conversation used to crash the console.
 *
 * The chat route streamed a turn with its readings *including* the individual
 * items, and persisted the same turn with only the counts. A live answer
 * therefore rendered fine while its stored copy was a different, thinner object,
 * and the evidence panel read `readings.items.length` — a `TypeError` on
 * `undefined`, which React turned into the whole admin page falling into its
 * error boundary. Clicking a saved chat appeared to lead nowhere; the transcript
 * was never the problem.
 *
 * The first test is that exact stored shape. It is the one that must never be
 * allowed to throw again.
 */

describe("stored turn evidence", () => {
  it("reads the counts-only shape the route used to persist", () => {
    const stored = { taken: 12, missing: 1, state: "warn" };

    const summary = toReadingsSummary(stored);

    expect(summary).not.toBeNull();
    expect(summary?.taken).toBe(12);
    expect(summary?.missing).toBe(1);
    expect(summary?.state).toBe("warn");
    // The field whose absence crashed the render. It must be an array, always.
    expect(Array.isArray(summary?.items)).toBe(true);
    expect(summary?.items).toHaveLength(0);
  });

  it("keeps the readings when they were stored", () => {
    const summary = toReadingsSummary({
      taken: 1,
      missing: 0,
      state: "ok",
      items: [
        { id: "hive", area: "Mind", label: "Hive memory", value: "14,085 memories", state: "ok" },
        { id: "model", area: "Mind", label: "Models", value: "no gateway key", state: "warn", detail: "set one" },
      ],
    });

    expect(summary?.items).toHaveLength(2);
    expect(summary?.items[0]?.id).toBe("hive");
    expect(summary?.items[1]?.detail).toBe("set one");
  });

  it("derives the count from the items when the count was not stored", () => {
    const summary = toReadingsSummary({
      items: [{ id: "a", area: "A", label: "A", value: "1", state: "ok" }],
    });

    expect(summary?.taken).toBe(1);
    expect(summary?.missing).toBe(0);
  });

  it("drops unreadable entries instead of rendering blank rows", () => {
    const summary = toReadingsSummary({
      taken: 3,
      missing: 0,
      state: "ok",
      items: [null, "nonsense", {}, { id: "real", area: "X", label: "X", value: "v", state: "ok" }],
    });

    expect(summary?.items).toHaveLength(1);
    expect(summary?.items[0]?.id).toBe("real");
  });

  it("falls back to a known state rather than passing an unknown one through", () => {
    const summary = toReadingsSummary({ taken: 1, missing: 0, state: "banana" });
    expect(summary?.state).toBe("unknown");
  });

  it("returns null for values that are not evidence at all", () => {
    expect(toReadingsSummary(null)).toBeNull();
    expect(toReadingsSummary(undefined)).toBeNull();
    expect(toReadingsSummary("12 readings")).toBeNull();
    expect(toReadingsSummary([])).toBeNull();
    expect(toReadingsSummary({ unrelated: true })).toBeNull();
  });
});
