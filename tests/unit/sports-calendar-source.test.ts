import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The fixture calendar's ESPN contract.
 *
 * The calendar merges two sources: ESPN for the current window and the
 * openfootball archive for the season. For a while it rendered "no fixtures" on
 * days when matches were being played, and the reason was one query parameter.
 *
 * ESPN's scoreboard endpoint used to answer `dates=YYYYMMDD-YYYYMMDD`. It no
 * longer does: measured against production, the range form returned **HTTP 400
 * `Failed to get events endpoint`** for every league tried, while the same URL
 * with no `dates` returned 200 with the current matchday. Every ESPN request
 * failed, so the calendar fell through to the archive alone — which fills
 * October onward and holds nothing for the current week. An empty source read as
 * an empty season.
 *
 * These assertions are about the *shape of the request*, not the response, so
 * they hold without a network call and without a provider fixture.
 */

const SOURCE = readFileSync(join(process.cwd(), "src/lib/sports-calendar.ts"), "utf8");

describe("ESPN scoreboard request shape", () => {
  it("never asks for a date range", () => {
    // The two ways a range gets written: an interpolated pair…
    expect(SOURCE).not.toMatch(/dates=\$\{[A-Za-z]+\}-\$\{/);
    // …and the literal form, in case someone hard-codes a window.
    expect(SOURCE).not.toMatch(/dates=\d{8}-\d{8}/);
  });

  it("asks for the endpoint's default window", () => {
    // The query that actually answers. Pinning it is the point: an empty
    // `dates` or a league-specific override would be just as invisible as the
    // range was, because the failure mode is a 400 that reads as "no fixtures".
    expect(SOURCE).toContain("scoreboard?limit=400");
  });

  it("keeps the request count at one per league", () => {
    // The range form was one request per league. The obvious workaround — a
    // request per league per day — would be hundreds per render at the
    // fifty-six leagues this desk carries, so the endpoint must not be asked
    // about individual dates at all. Reintroducing `dates=` is a deliberate
    // decision that has to update this test, not an accident.
    expect(SOURCE).not.toContain("scoreboard?dates=");
  });
});
