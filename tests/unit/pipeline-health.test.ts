import { describe, expect, it } from "vitest";
import {
  classifyRssIntake,
  classifyScheduler,
  classifyViewSync,
  humanAge,
  overallPipelineState,
  worseState,
  type PipelineCheck,
  type PipelineState,
  type SchedulerJobSignal,
} from "@/lib/pipeline-health";
import type { JobHeartbeat } from "@/lib/job-heartbeat";

const MINUTE = 60_000;
/** Fixed clock for the classifiers that accept one (RSS, scheduler). */
const NOW = Date.parse("2026-09-17T12:00:00.000Z");
/** Heartbeat ages are measured against the real clock inside the ledger
 *  helpers, so the fold fixture is dated from the real one to stay exact. */
const REAL_NOW = Date.now();
const FOLD_CADENCE = 1440;

function foldAt(minutesAgo: number, ok = true, detail = "12 posts · 480 views folded"): JobHeartbeat {
  return {
    jobId: "view-sync",
    at: new Date(REAL_NOW - minutesAgo * MINUTE).toISOString(),
    ok,
    detail,
  };
}

function viewSync(overrides: Partial<Parameters<typeof classifyViewSync>[0]> = {}) {
  return classifyViewSync({
    configured: true,
    reachable: "ok",
    error: null,
    pending: { posts: 26, views: 1500, capped: false },
    lastFold: foldAt(500),
    expectedMinutes: FOLD_CADENCE,
    ...overrides,
  });
}

function job(overrides: Partial<SchedulerJobSignal> = {}): SchedulerJobSignal {
  return {
    id: "rss-poll",
    name: "RSS syndication",
    cron: "0 */12 * * *",
    essential: true,
    lastRun: new Date(NOW - 60 * MINUTE).toISOString(),
    ageMinutes: 60,
    expectedMinutes: 720,
    stale: false,
    ok: true,
    ...overrides,
  };
}

describe("view sync", () => {
  it("reports a backlog between passes as healthy", () => {
    // The whole point: 1,500 waiting views are the DESIGN, not a fault. Only a
    // fold that is past its slot is a fault.
    const check = viewSync();
    expect(check.state).toBe("ok");
    expect(check.headline).toContain("on schedule");
    expect(check.ageMinutes).toBe(500);
    expect(check.lastSuccessAt).not.toBeNull();
  });

  it("treats an unconfigured offload as a deliberate deployment, not a fault", () => {
    const check = viewSync({ configured: false, pending: null, lastFold: null });
    expect(check.state).toBe("ok");
    expect(check.headline).toBe("Offload disabled");
  });

  it("is critical when Convex cannot be reached at all", () => {
    const check = viewSync({ reachable: "failing", error: "fetch failed", pending: null });
    expect(check.state).toBe("critical");
    expect(check.detail).toContain("fetch failed");
  });

  it("does not read an unreadable backlog as an empty one", () => {
    const check = viewSync({ pending: null });
    expect(check.state).toBe("unknown");
    expect(check.headline).toContain("could not be measured");
  });

  it("warns when the fold is past its slot but not yet a full cycle behind", () => {
    // 32h against a 24h cadence: one nightly pass did not happen.
    const check = viewSync({ lastFold: foldAt(32 * 60) });
    expect(check.state).toBe("warn");
    expect(check.headline).toBe("Fold is running late");
  });

  it("is critical when the fold has missed a whole cycle", () => {
    const check = viewSync({ lastFold: foldAt(50 * 60) });
    expect(check.state).toBe("critical");
    expect(check.headline).toContain("stale");
    expect(check.detail).toContain("every 24h");
  });

  it("is critical when the last fold ran and failed, even mid-cadence", () => {
    // Recent age, but the backlog is not moving — that is the failure the age
    // alone would hide.
    const check = viewSync({ lastFold: foldAt(90, false, "Convex unreachable — view deltas could not be folded") });
    expect(check.state).toBe("critical");
    expect(check.headline).toBe("The last view fold failed");
    expect(check.lastSuccessAt).toBeNull();
  });

  it("warns when views are waiting and no fold has ever been recorded", () => {
    const check = viewSync({ lastFold: null });
    expect(check.state).toBe("warn");
    expect(check.headline).toContain("no fold on record");
  });

  it("is ok with nothing waiting", () => {
    const check = viewSync({ pending: { posts: 0, views: 0, capped: false } });
    expect(check.state).toBe("ok");
    expect(check.headline).toBe("Nothing waiting");
  });

  it("marks a capped backlog as an open-ended count instead of a precise one", () => {
    const check = viewSync({ pending: { posts: 500, views: 9000, capped: true } });
    expect(check.evidence[0]?.value).toContain("9000+");
  });
});

describe("rss intake", () => {
  const base = {
    activeFeeds: 12,
    successfulFeeds: 12,
    failingFeeds: 0,
    neverPolled: 0,
    lastSuccessAt: new Date(NOW - 3 * 60 * MINUTE),
    lastImportedAt: new Date(NOW - 90 * MINUTE),
    expectedMinutes: 720,
  };

  it("is healthy when feeds answered on schedule", () => {
    const check = classifyRssIntake(base, NOW);
    expect(check.state).toBe("ok");
    expect(check.ageMinutes).toBe(180);
  });

  it("warns when a cycle has been missed", () => {
    const check = classifyRssIntake({ ...base, lastSuccessAt: new Date(NOW - 16 * 60 * MINUTE) }, NOW);
    expect(check.state).toBe("warn");
    expect(check.headline).toContain("behind");
  });

  it("is critical once the intake has gone fully silent", () => {
    const check = classifyRssIntake({ ...base, lastSuccessAt: new Date(NOW - 30 * 60 * MINUTE) }, NOW);
    expect(check.state).toBe("critical");
    expect(check.headline).toContain("No successful poll");
  });

  it("distinguishes a quiet intake from a dead one", () => {
    // Feeds answered cleanly; nothing was published upstream. Not an incident.
    const check = classifyRssIntake({ ...base, lastImportedAt: new Date(NOW - 40 * 60 * MINUTE) }, NOW);
    expect(check.state).toBe("ok");
    expect(check.detail).toContain("answering on schedule");
  });

  it("escalates to a warning while some feeds are failing", () => {
    const check = classifyRssIntake({ ...base, successfulFeeds: 9, failingFeeds: 3 }, NOW);
    expect(check.state).toBe("warn");
    expect(check.headline).toContain("3 feeds failing");
  });

  it("warns rather than passing when no poll has ever completed", () => {
    const check = classifyRssIntake({ ...base, lastSuccessAt: null, neverPolled: 12 }, NOW);
    expect(check.state).toBe("warn");
    expect(check.headline).toBe("No feed has completed a poll");
  });

  it("is unknown with nothing to syndicate", () => {
    const check = classifyRssIntake({ ...base, activeFeeds: 0, successfulFeeds: 0, lastSuccessAt: null }, NOW);
    expect(check.state).toBe("unknown");
  });
});

describe("scheduler heartbeats", () => {
  it("is healthy when every job beat within its spacing", () => {
    const check = classifyScheduler({
      jobs: [job(), job({ id: "hive-sweep", name: "Nightly hive training", ageMinutes: 700, stale: false })],
      ledger: "redis",
    });
    expect(check.state).toBe("ok");
    expect(check.headline).toContain("beating on schedule");
  });

  it("is critical when an essential job has stopped firing", () => {
    const check = classifyScheduler({
      jobs: [job({ lastRun: null, ageMinutes: null, stale: true })],
      ledger: "redis",
    });
    expect(check.state).toBe("critical");
    expect(check.headline).toContain("essential job");
    expect(check.detail).toContain("never");
  });

  it("only warns when a non-essential job is behind", () => {
    const check = classifyScheduler({
      jobs: [
        job(),
        job({ id: "platform-pulse", name: "Platform pulse", essential: false, ageMinutes: 900, stale: true }),
      ],
      ledger: "redis",
    });
    expect(check.state).toBe("warn");
    expect(check.detail).toContain("Platform pulse");
  });

  it("reports a blind ledger as unmeasured rather than as dead jobs", () => {
    const check = classifyScheduler({
      jobs: [job({ lastRun: null, ageMinutes: null, stale: true })],
      ledger: "unavailable",
    });
    expect(check.state).toBe("unknown");
    expect(check.headline).toBe("Heartbeat ledger unavailable");
  });

  it("surfaces the Postgres fallback ledger as a warning", () => {
    const check = classifyScheduler({ jobs: [job()], ledger: "database" });
    expect(check.evidence[0]?.state).toBe("warn");
    expect(check.evidence[0]?.value).toContain("Postgres");
  });
});

describe("overall state", () => {
  function checkAt(state: PipelineState): PipelineCheck {
    return {
      id: "scheduler",
      label: "x",
      state,
      headline: "",
      detail: "",
      lastSuccessAt: null,
      ageMinutes: null,
      expectedMinutes: null,
      evidence: [],
    };
  }

  it("ranks unknown above ok so blindness is never reported as health", () => {
    expect(worseState("ok", "unknown")).toBe("unknown");
    expect(overallPipelineState([checkAt("ok"), checkAt("unknown")])).toBe("unknown");
  });

  it("lets the worst pipeline decide", () => {
    expect(overallPipelineState([checkAt("ok"), checkAt("warn"), checkAt("critical")])).toBe("critical");
    expect(overallPipelineState([checkAt("ok"), checkAt("warn")])).toBe("warn");
    expect(overallPipelineState([checkAt("ok")])).toBe("ok");
  });

  it("is unknown with nothing measured", () => {
    expect(overallPipelineState([])).toBe("unknown");
  });
});

describe("humanAge", () => {
  it("reads ages the way an operator says them", () => {
    expect(humanAge(null)).toBe("never");
    expect(humanAge(0)).toBe("just now");
    expect(humanAge(42)).toBe("42m");
    expect(humanAge(150)).toBe("2h");
    expect(humanAge(60 * 50)).toBe("2d 2h");
    expect(humanAge(60 * 48)).toBe("2d");
  });
});
