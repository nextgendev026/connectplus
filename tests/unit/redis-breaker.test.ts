import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Redis circuit breaker, and the retirement of a refused client.
 *
 * Why this is worth a test. The cache layer is deliberately silent — a broken
 * cache must never break a page — so its failure modes are invisible from the
 * outside. Two of them turned out to be expensive rather than merely untidy:
 *
 *   1. An ioredis client whose connection is *refused* keeps retrying in the
 *      background. The old code only dropped the reference, so a wrong password
 *      left the socket re-sending rejected credentials for the life of the
 *      process. Measured against the live endpoint: two further failed
 *      authentications inside 2.5s when the reference was dropped, and none once
 *      `disconnect()` was called.
 *
 *   2. The circuit breaker never armed for a credential rejection, because it
 *      only counted failures from *commands* — and a refused connection never
 *      issues one. `disabledUntil` therefore stayed at zero and every cache call
 *      kept paying a doomed round-trip.
 *
 * Both are pinned here so they cannot quietly come back.
 */

const state = vi.hoisted(() => {
  // Must be set before the module under test is imported: it reads REDIS_URL (and
  // resolves which cache tier is live) at load time.
  process.env.REDIS_URL = "redis://default:rotated@127.0.0.1:6379";
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.KV_URL;
  delete process.env.CACHE_BACKEND;
  return {
    connects: 0,
    disconnects: 0,
    pings: 0,
    connectFails: false,
    pingFails: false,
  };
});

vi.mock("ioredis", () => {
  class FakeRedis {
    status = "connecting";
    on() {
      return this;
    }
    async connect() {
      state.connects++;
      if (state.connectFails) {
        // What ioredis surfaces when the server rejects the credential: the
        // rejection promise says only "Connection is closed", while the real
        // WRONGPASS arrives on the error event.
        throw new Error("Connection is closed.");
      }
    }
    async ping() {
      state.pings++;
      if (state.pingFails) throw new Error("socket closed mid-command");
      return "PONG";
    }
    async set() {
      return "OK";
    }
    disconnect() {
      state.disconnects++;
    }
  }
  return { default: FakeRedis };
});

beforeEach(() => {
  vi.resetModules();
  state.connects = 0;
  state.disconnects = 0;
  state.pings = 0;
  state.connectFails = false;
  state.pingFails = false;
});

describe("a refused connection", () => {
  it("disconnects the client instead of leaving it to reconnect forever", async () => {
    state.connectFails = true;
    const { redisSetEx } = await import("@/lib/redis");

    const ok = await redisSetEx("heartbeat", 60, "{}");

    expect(ok).toBe(false);
    expect(state.connects).toBe(1);
    // The whole point: the retry loop is ended, not merely dereferenced.
    expect(state.disconnects).toBe(1);
  });

  it("does not re-probe on every subsequent call", async () => {
    state.connectFails = true;
    const { redisSetEx } = await import("@/lib/redis");

    await redisSetEx("a", 60, "{}");
    await redisSetEx("b", 60, "{}");
    await redisSetEx("c", 60, "{}");

    // One refused handshake for the process, not one per cache call. (Serverless
    // instances are short-lived, so this is the right unit of amortisation.)
    expect(state.connects).toBe(1);
    expect(state.disconnects).toBe(1);
  });
});

describe("commands that fail on a live socket", () => {
  it("arms the cooldown so later calls are skipped rather than retried", async () => {
    state.pingFails = true;
    const { redisSetEx } = await import("@/lib/redis");

    // Five attempts against FAIL_THRESHOLD=3.
    for (const key of ["a", "b", "c", "d", "e"]) {
      expect(await redisSetEx(key, 60, "{}")).toBe(false);
    }

    // Exactly the threshold: the breaker trips and the remaining calls return
    // early. Before this, every one of the five paid a failed round-trip.
    expect(state.pings).toBe(3);
  });

  it("keeps reporting success only when a real write lands", async () => {
    const { redisSetEx } = await import("@/lib/redis");
    expect(await redisSetEx("ok", 60, "{}")).toBe(true);
  });
});
