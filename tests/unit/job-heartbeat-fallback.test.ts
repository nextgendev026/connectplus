import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The heartbeat ledger's durable tier, and the throttle built on it.
 *
 * Why this matters enough to test: with Redis unavailable and no fallback, every
 * job reads back as "never ran". That single fact used to surface as "Inngest is
 * degraded — 3 essential jobs past due", which sends an operator to investigate
 * the queue while the actual fault is the cache. The Postgres tier is what keeps
 * staleness a measurement of the job rather than of Redis.
 */

const redisState = { available: true, raw: null as string | null, failWrite: false };

vi.mock("@/lib/redis", () => ({
  redisAvailable: () => redisState.available,
  redisGetRaw: async () => {
    if (!redisState.available) throw new Error("REDIS_URL credentials rejected");
    return redisState.raw;
  },
  redisSetEx: async (_key: string, _ttl: number, value: string) => {
    if (redisState.failWrite) throw new Error("WRONGPASS invalid username-password pair");
    redisState.raw = value;
    return true;
  },
}));

/** Minimal stand-in for the PlatformSetting row the durable tier uses. */
const db = new Map<string, string>();
/** When true, the durable tier is *broken* rather than merely empty. */
const dbState = { fail: false };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    platformSetting: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        if (dbState.fail) throw new Error("connection terminated unexpectedly");
        const value = db.get(where.key);
        return value === undefined ? null : { value };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { key: string };
        create: { value: string };
        update: { value: string };
      }) => {
        db.set(where.key, db.has(where.key) ? update.value : create.value);
        return { key: where.key };
      },
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

import {
  heartbeatAgeMinutes,
  heartbeatLedger,
  isStale,
  readHeartbeat,
  recordHeartbeat,
  resetHeartbeatLedger,
} from "../../src/lib/job-heartbeat";
import { runThrottled } from "../../src/lib/throttled-job";

beforeEach(() => {
  db.clear();
  redisState.available = true;
  redisState.raw = null;
  redisState.failWrite = false;
  dbState.fail = false;
  resetHeartbeatLedger();
});

describe("heartbeat ledger", () => {
  it("uses Redis when it is healthy", async () => {
    await recordHeartbeat("sports-live");
    expect(heartbeatLedger()).toBe("redis");
    expect(redisState.raw).not.toBeNull();
    expect(db.size).toBe(0);
  });

  it("falls back to Postgres when Redis is unreachable", async () => {
    redisState.available = false;
    await recordHeartbeat("sports-notify", { ok: true });

    expect(heartbeatLedger()).toBe("database");
    expect(db.size).toBe(1);

    const beat = await readHeartbeat("sports-notify");
    expect(beat?.jobId).toBe("sports-notify");
    expect(heartbeatAgeMinutes(beat)).toBe(0);
  });

  it("falls back when Redis accepts the connection but rejects the write", async () => {
    // The exact production symptom: REDIS_URL is set, so `redisAvailable()` is
    // true, yet every command fails. A write that throws must not lose the only
    // record that the job ran.
    redisState.available = true;
    redisState.failWrite = true;

    await recordHeartbeat("rss-poll");
    expect(heartbeatLedger()).toBe("database");
    expect(db.size).toBe(1);
  });

  it("reports a job as stale when it has never run at all", () => {
    expect(isStale(null, 5)).toBe(true);
    expect(heartbeatAgeMinutes(null)).toBeNull();
  });

  it("treats an empty ledger as readable rather than blind", async () => {
    /*
     * The distinction the scheduler alarm turns on. Redis answered and holds no
     * key, and Postgres answered and holds no row: both are authoritative
     * silences. Reporting the tier as "unavailable" here is what made the console
     * announce a ledger outage for a scheduler that had simply never run.
     */
    expect(await readHeartbeat("publish-scheduled")).toBeNull();
    expect(heartbeatLedger()).not.toBe("unavailable");
  });

  it("reports unreadable only when no tier can answer", async () => {
    redisState.available = false;
    dbState.fail = true;
    expect(await readHeartbeat("publish-scheduled")).toBeNull();
    expect(heartbeatLedger()).toBe("unavailable");
  });

  it("keeps a fresh heartbeat out of the stale bucket", async () => {
    await recordHeartbeat("status-watchdog");
    const beat = await readHeartbeat("status-watchdog");
    expect(isStale(beat, 5)).toBe(false);
  });
});

describe("runThrottled", () => {
  it("runs once and then stands down inside the interval", async () => {
    const work = vi.fn(async () => "done");

    const first = await runThrottled("sports-notify", 60_000, work);
    expect(first).toEqual({ ran: true, reason: "ok" });
    expect(work).toHaveBeenCalledTimes(1);

    const second = await runThrottled("sports-notify", 60_000, work);
    expect(second).toEqual({ ran: false, reason: "throttled" });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("runs again once the interval has elapsed", async () => {
    const work = vi.fn(async () => "done");
    await runThrottled("sports-intel", 60_000, work);

    // Age the ledger entry by rewriting it two minutes into the past. Redis is
    // the tier the reader consults first while it is healthy, so age that copy.
    redisState.raw = JSON.stringify({
      jobId: "sports-intel",
      at: new Date(Date.now() - 120_000).toISOString(),
      ok: true,
    });

    const next = await runThrottled("sports-intel", 60_000, work);
    expect(next.ran).toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("records a failure and does not claim it ran", async () => {
    const result = await runThrottled("sports-live", 0, async () => {
      throw new Error("upstream is down");
    });
    expect(result).toEqual({ ran: false, reason: "failed" });

    const beat = await readHeartbeat("sports-live");
    expect(beat?.ok).toBe(false);
    expect(beat?.detail).toContain("upstream is down");
  });

  it("throttles across tiers — a Redis heartbeat suppresses a fallback run", async () => {
    const work = vi.fn(async () => "done");
    await recordHeartbeat("sports-notify");
    const result = await runThrottled("sports-notify", 60_000, work);
    expect(result.reason).toBe("throttled");
    expect(work).not.toHaveBeenCalled();
  });
});
