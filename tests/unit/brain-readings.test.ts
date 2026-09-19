import { describe, expect, it } from "vitest";
import { formatReadings, summarizeReadings, type BrainReading } from "@/lib/brain-readings";

/**
 * The brief is the brain's ground truth, so its *rendering* is load-bearing: an
 * answer that ignores the readings is usually a brief that never carried them.
 */
const readings: BrainReading[] = [
  { id: "audience", area: "Audience", label: "People", value: "1,204 total, 31 joined this week", state: "ok" },
  {
    id: "scheduler",
    area: "Scheduler",
    label: "Scheduled jobs",
    value: "2 of 9 behind: view-sync (4h ago)",
    state: "warn",
    detail: "1 of the last runs reported failure.",
  },
  {
    id: "moderation-queue",
    area: "Content",
    label: "Moderation queue",
    value: "41 items waiting",
    state: "critical",
  },
  { id: "hive", area: "Mind", label: "Hive memory", value: "unavailable", state: "unknown", detail: "the store threw" },
];

describe("the readings brief", () => {
  it("carries every reading, with the state each one is in", () => {
    const text = formatReadings(readings);
    expect(text).toContain("1,204 total");
    expect(text).toContain("[degraded]");
    expect(text).toContain("[CRITICAL]");
    expect(text).toContain("[could not be read]");
  });

  it("tells the model plainly that the readings are ground truth", () => {
    const text = formatReadings(readings);
    expect(text).toContain("ground truth");
    expect(text).toContain("LIVE PLATFORM READINGS");
  });

  it("keeps a failed probe visible instead of dropping the line", () => {
    const text = formatReadings(readings);
    expect(text).toContain("Hive memory");
    expect(text).toContain("the store threw");
  });

  it("says so when there is nothing to brief", () => {
    expect(formatReadings([])).toContain("No live readings");
  });
});

describe("reading summaries", () => {
  it("counts the readings by state", () => {
    expect(summarizeReadings(readings)).toEqual({ ok: 1, warn: 1, critical: 1, unknown: 1 });
  });

  it("counts nothing as ok when nothing was read", () => {
    expect(summarizeReadings([])).toEqual({ ok: 0, warn: 0, critical: 0, unknown: 0 });
  });
});
