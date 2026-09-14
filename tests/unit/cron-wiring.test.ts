import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_JOBS, ESSENTIAL_JOBS } from "../../src/lib/cron-schedule";
import { isStale, heartbeatAgeMinutes, type JobHeartbeat } from "../../src/lib/job-heartbeat";

/**
 * Cron wiring contract.
 *
 * The scheduling story is deliberately split across three files — Inngest cron
 * triggers (execution), lib/cron-schedule (the registry the console reads) and
 * vercel.json (the one fallback slot). Those three drifting apart is exactly how
 * a job silently stops running, so this test reads them all and asserts they
 * agree.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("cron ownership", () => {
  it("mirrors every registry schedule as an Inngest cron trigger", () => {
    const inngest = read("src/inngest/functions.ts");
    const missing = CRON_JOBS.filter((job) => !inngest.includes(`cron: "${job.cron}"`)).map((j) => j.id);
    expect(missing, `jobs with no Inngest cron trigger: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the event trigger too, so admins can still run a job on demand", () => {
    const inngest = read("src/inngest/functions.ts");
    for (const id of ["publish-scheduled", "rss-poll", "hive-sweep", "embed-posts"]) {
      expect(inngest).toContain(`{ event: "${id}" }`);
    }
  });

  it("stamps a heartbeat in every Inngest function it schedules", () => {
    const inngest = read("src/inngest/functions.ts");
    const missing = CRON_JOBS.filter(
      (job) => !inngest.includes(`recordHeartbeat("${job.id}")`)
    ).map((j) => j.id);
    expect(missing, `jobs with no heartbeat step: ${missing.join(", ")}`).toEqual([]);
  });

  it("spends Vercel's cron allowance on the safety net alone", () => {
    const vercel = JSON.parse(read("vercel.json")) as {
      crons?: { path: string; schedule: string }[];
    };
    expect(vercel.crons).toHaveLength(1);
    expect(vercel.crons?.[0]?.path).toBe("/api/cron/safety-net");
    // The old direct poller would double-fire alongside Inngest's hourly cron.
    expect(read("vercel.json")).not.toContain("/api/rss/cron?trigger=rss-poll");
  });

  it("covers exactly the jobs whose silence is user-visible", () => {
    expect(ESSENTIAL_JOBS.map((j) => j.id).sort()).toEqual([
      "publish-scheduled",
      "rss-poll",
      "status-watchdog",
    ]);
  });

  it("declares a cadence that matches the cron expression", () => {
    const everyFive = CRON_JOBS.filter((j) => j.cron === "*/5 * * * *").map((j) => j.everyMinutes);
    expect(everyFive.every((m) => m === 5)).toBe(true);
  });

  it("polls syndication six-hourly rather than hourly", () => {
    // Hourly re-downloaded the same unchanged documents six times a day for news
    // that does not move that fast. The registry, the Inngest trigger and the
    // declared spacing all have to agree, or the console reports a healthy job
    // that is actually running on a different clock.
    const rss = CRON_JOBS.find((j) => j.id === "rss-poll");
    expect(rss?.cron).toBe("0 */6 * * *");
    expect(rss?.everyMinutes).toBe(360);
  });

  it("keeps the Cloudflare edge schedules pointed at real jobs", () => {
    // The worker owns the high-frequency jobs (radio metadata, livescore,
    // model refresh) through Cron Triggers. It names a job id rather than doing
    // the work, so a rename in the registry has to fail here instead of silently
    // pinging an endpoint that answers 404 forever.
    const worker = read("workers/edge-cache/src/index.mjs");
    const triggers = [...worker.matchAll(/trigger: "([a-z-]+)"/g)].map((m) => m[1]!);
    expect(triggers.length).toBeGreaterThan(0);
    const ids = new Set(CRON_JOBS.map((j) => j.id));
    const unknown = triggers.filter((t) => !ids.has(t));
    expect(unknown, `edge schedules naming jobs that do not exist: ${unknown.join(", ")}`).toEqual([]);

    // The deploy script registers the same crons as the worker maps.
    const deploy = read("scripts/deploy-worker.mjs");
    const deployCrons = [...deploy.matchAll(/cron: "([^"]+)"/g)].map((m) => m[1]!);
    for (const cron of deployCrons) {
      expect(worker, `deploy registers ${cron} but the worker has no handler for it`).toContain(
        `cron: "${cron}"`
      );
    }
  });

  it("schedules a payment reconciliation job", () => {
    const payments = CRON_JOBS.find((j) => j.id === "payments-lifecycle");
    expect(payments).toBeDefined();
    // Not in the daily safety net: reconciling six-hourly drift once a day would
    // fire on every pass because the job always looks stale to a daily check.
    expect(payments?.essential).toBe(false);
    expect(read("src/lib/cron-jobs.ts")).toContain("expireLapsedSubscriptions");
  });

  it("derives the external scheduler's triggers from the registry", () => {
    // cron-job.org pings /api/cron?trigger=<jobId>. If that list were hand-kept
    // it would drift from the registry the moment a job is added, so it is
    // derived — and this asserts the derivation is still in place.
    const route = read("src/app/api/cron/route.ts");
    expect(route).toContain("CRON_JOBS.map");
    expect(route).not.toMatch(/const TRIGGERS = \{/);
    // The discovery payload is what a scheduler is configured from.
    expect(route).toContain("endpoint: \"/api/cron?trigger=<jobId>\"");
    // Legacy names keep working for schedulers already configured.
    expect(route).toContain("recover-thumbnails");
    expect(route).toContain("radio-status-sweep");
  });

  it("keeps the livescore heartbeat and favourite alerts on their own cadence", () => {
    const live = CRON_JOBS.find((j) => j.id === "sports-live");
    const notify = CRON_JOBS.find((j) => j.id === "sports-notify");
    expect(live?.cron).toBe("*/2 * * * *");
    expect(notify?.cron).toBe("*/5 * * * *");
    // Neither belongs in the daily Vercel safety net: a stale scoreboard is
    // recovered by the next tick, not by a once-a-day catch-up run.
    expect(live?.essential).toBe(false);
    expect(notify?.essential).toBe(false);
  });

  it("self-heals the sports jobs without a scheduler", () => {
    // Inngest owns the cadence, but it cannot notice its own absence: if the app
    // is paused or unsynced, picks stop generating and favourited fixtures stop
    // notifying with nothing surfacing the fault. The livescore route is the
    // busiest page in the app, so it carries a throttled opportunity to catch
    // up — AFTER the response, so no visitor waits on it.
    const live = read("src/app/api/sports/live/route.ts");
    expect(live).toContain("runThrottled");
    expect(live).toContain('runThrottled("sports-notify"');
    expect(live).toContain('runThrottled("sports-intel"');
    // Post-response work only: the scoreboard must never block on model training.
    expect(live).toContain("after(async () => {");

    // The throttle is meaningless without a durable ledger, so the fallback that
    // keeps staleness honest when Redis is down has to stay wired.
    const heartbeat = read("src/lib/job-heartbeat.ts");
    expect(heartbeat).toContain("platformSetting.upsert");
    expect(heartbeat).toContain("PLATFORM".replace("PLATFORM", "heartbeatLedger"));
  });
});

describe("heartbeat staleness", () => {
  const hb = (minutesAgo: number): JobHeartbeat => ({
    jobId: "rss-poll",
    at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    ok: true,
  });

  it("treats a never-run job as stale so the safety net picks it up", () => {
    expect(isStale(null, 60)).toBe(true);
    expect(heartbeatAgeMinutes(null)).toBeNull();
  });

  it("keeps a job inside its grace window out of the safety net", () => {
    expect(isStale(hb(30), 60)).toBe(false);
    expect(isStale(hb(119), 60)).toBe(false);
  });

  it("flags a job that has missed two full cycles", () => {
    expect(isStale(hb(121), 60)).toBe(true);
    expect(isStale(hb(60 * 6), 60)).toBe(true);
  });
});
