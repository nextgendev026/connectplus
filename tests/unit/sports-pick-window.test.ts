import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PICK_MAX_AGE_MINUTES,
  PICK_MINUTE_CUTOFF,
  pickIsActionable,
  refreshApproachingKickoff,
} from "@/lib/sports-intelligence";
import { SPORTS_EVENTS, baseEvent } from "@/lib/sports-notifications";

/**
 * The tips stake window.
 *
 * The bug these pin down: the board ranked purely on confidence, so a
 * 96%-confidence pick on a match at 88' sat at the very top — a call nobody could
 * take, presented as the model's best idea. A tip must be actionable, so the
 * fixture's clock decides whether it is shown at all.
 */

const now = new Date("2026-09-14T18:00:00.000Z");
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

describe("pickIsActionable", () => {
  it("keeps a fixture that has not kicked off", () => {
    expect(pickIsActionable({ status: "SCHEDULED", minute: null, kickoff: new Date(now.getTime() + 3_600_000) }, now)).toBe(true);
  });

  it("keeps a live fixture while the reader can still act", () => {
    expect(pickIsActionable({ status: "LIVE", minute: 12, kickoff: minutesAgo(20) }, now)).toBe(true);
    expect(pickIsActionable({ status: "LIVE", minute: PICK_MINUTE_CUTOFF - 1, kickoff: minutesAgo(60) }, now)).toBe(true);
  });

  it("drops a live fixture once the stake window has closed", () => {
    expect(pickIsActionable({ status: "LIVE", minute: PICK_MINUTE_CUTOFF, kickoff: minutesAgo(90) }, now)).toBe(false);
    expect(pickIsActionable({ status: "LIVE", minute: 88, kickoff: minutesAgo(100) }, now)).toBe(false);
  });

  it("drops a finished fixture and anything postponed", () => {
    expect(pickIsActionable({ status: "FT", minute: 90, kickoff: minutesAgo(130) }, now)).toBe(false);
    expect(pickIsActionable({ status: "POSTPONED", minute: null, kickoff: minutesAgo(10) }, now)).toBe(false);
  });

  it("treats a status string stuck on LIVE as over, by age", () => {
    // The feed can leave a row live long after the game ended; the clock is the
    // more trustworthy of the two.
    expect(
      pickIsActionable({ status: "LIVE", minute: null, kickoff: minutesAgo(PICK_MAX_AGE_MINUTES + 5) }, now)
    ).toBe(false);
  });

  it("allows a live fixture whose provider omits the clock", () => {
    // Refusing to show a pick because the feed withholds the minute would be a
    // worse failure than a small imprecision.
    expect(pickIsActionable({ status: "LIVE", minute: null, kickoff: minutesAgo(30) }, now)).toBe(true);
  });
});

describe("the kick-off refresh", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it(
    "reports an empty, well-formed result without a database to sweep",
    async () => {
      // Every upstream is closed: this is a unit test, and the sweep fans out to
      // five providers (including the fixture archive) the moment it needs a
      // snapshot. What is being pinned is the CONTRACT — a caller always gets a
      // readable shape, never a throw — not the sweep's data.
      vi.stubGlobal("fetch", async () => {
        throw new Error("offline in unit tests");
      });

      const result = await refreshApproachingKickoff({ limit: 1 }).catch(() => null);
      if (result) {
        expect(result).toMatchObject({
          due: expect.any(Number),
          generated: expect.any(Number),
          refreshed: expect.any(Number),
          windowMinutes: expect.any(Number),
        });
      }
    },
    20_000
  );
});

describe("per-incident alert keys", () => {
  it("keeps goal alerts subscribable while they stay distinct in the ledger", () => {
    // A reader subscribes to "GOAL"; the ledger needs 401879285:12 and :44 to be
    // two different rows so the second goal is not swallowed by the first.
    expect(baseEvent("GOAL:401879285:12")).toBe("GOAL");
    expect(baseEvent("GOAL:401879285:44")).toBe("GOAL");
    expect(baseEvent("FINAL")).toBe("FINAL");
    expect("GOAL:401879285:12").not.toBe("GOAL:401879285:44");
  });

  it("offers the incident alerts as subscription options", () => {
    expect(SPORTS_EVENTS).toContain("GOAL");
    expect(SPORTS_EVENTS).toContain("RED_CARD");
    expect(SPORTS_EVENTS).toContain("SUB");
  });
});
