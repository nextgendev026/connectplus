import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Where the work is allowed to run.
 *
 * This project's hosting allowance was being spent on three things that no user
 * asked for: read-only endpoints that were uncacheable and therefore invoked a
 * function on every poll, a job that executed twice (once queued, once inline),
 * and a cache tier that was never shown the single hottest request in the app.
 *
 * None of those are type errors and none of them fail a functional test — they
 * are *deployment* properties. So this file pins them the same way cron-wiring
 * pins the scheduler: by reading the real config and asserting the parts still
 * agree, because the failure mode is silence. A `no-store` header that comes
 * back looks exactly like a working endpoint, right up until the invoice.
 */

const send = vi.fn();

vi.mock("@/lib/inngest", () => ({ inngest: { send: (...a: unknown[]) => send(...a) } }));
vi.mock("@/lib/rss-poll", () => ({
  hasStaleFeeds: vi.fn(async () => true),
  pollFeeds: vi.fn(async () => ({})),
}));

const { HANDLED_EVENTS, triggerJob } = await import("@/lib/inngest-trigger");

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/** Endpoints the browser polls on a timer. Each one must be CDN-cacheable. */
const POLLED = ["/api/radio/stations", "/api/sports/live", "/api/sports/calendar", "/api/forex"];

afterEach(() => {
  send.mockReset();
  delete process.env.INNGEST_EVENT_KEY;
});

describe("Inngest hand-off", () => {
  it("only claims an event name that has a function registered", () => {
    const functions = read("src/inngest/functions.ts");
    const missing = [...HANDLED_EVENTS].filter((name) => !functions.includes(`id: "${name}"`));
    expect(missing, `handled events with no Inngest function: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not list sports-kickoff-refresh, which has no handler", () => {
    // The specific trap: this event name sits next to two others that ARE
    // handled and looks identical at the call site. Handing it off would queue
    // nothing and the route would skip its inline pass, so the refresh would
    // stop running with no error anywhere.
    expect(HANDLED_EVENTS.has("sports-kickoff-refresh")).toBe(false);
  });

  it("falls back to inline when no event key is configured", async () => {
    delete process.env.INNGEST_EVENT_KEY;
    expect(await triggerJob("sports-intel")).toEqual({ mode: "inline" });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses to hand off an event no function listens for, even with a key", async () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    expect(await triggerJob("sports-kickoff-refresh")).toEqual({ mode: "inline" });
    expect(send, "an unhandled event must not be sent and then trusted").not.toHaveBeenCalled();
  });

  it("reports inline when the queue accepts the event but returns no ids", async () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    send.mockResolvedValue({ ids: [] });
    expect(await triggerJob("sports-intel")).toEqual({ mode: "inline" });
  });

  it("reports inline when the send throws", async () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    send.mockRejectedValue(new Error("queue unreachable"));
    expect(await triggerJob("sports-intel")).toEqual({ mode: "inline" });
  });

  it("reports the queued event when the send is accepted", async () => {
    process.env.INNGEST_EVENT_KEY = "test-key";
    send.mockResolvedValue({ ids: ["evt_1"] });
    expect(await triggerJob("sports-intel", { reason: "missing-picks" })).toEqual({ mode: "inngest", eventIds: ["evt_1"] });
  });
});

describe("request paths do not run background work twice", () => {
  it("gates the sports pick top-up on the hand-off result", () => {
    const route = read("src/app/api/sports/live/route.ts");
    // The regression: the event was sent AND the model ran inline, so the same
    // generation happened twice per poll of the busiest page.
    expect(route).toContain('triggerJob("sports-intel"');
    expect(route).toContain('handoff.mode === "inngest"');
    expect(route, "a fire-and-forget send alongside the inline pass is the double run").not.toContain("void inngest");
  });

  it("gates the favourite alert sweep the same way", () => {
    expect(read("src/app/api/sports/live/route.ts")).toContain('triggerJob("sports-notify"');
  });

  it("leaves the kick-off refresh on the throttle, with a reason", () => {
    const route = read("src/app/api/sports/live/route.ts");
    expect(route).toContain('runThrottled("sports-kickoff-refresh"');
    expect(route).toContain("no function registered for");
  });
});

describe("read-only polls are cacheable at the edge", () => {
  it("gives every polled endpoint a shared cache TTL in next.config", () => {
    const config = read("next.config.mjs");
    for (const path of POLLED) {
      const block = new RegExp(`source: "${path.replace(/\//g, "\\/")}"[^\\n]*s-maxage=(\\d+)`);
      expect(block.test(config), `${path} has no s-maxage in next.config.mjs`).toBe(true);
    }
  });

  it("keeps vercel.json agreeing with next.config on the same paths", () => {
    // The config's own header comment: a header that exists in only one of the
    // two files is a header missing on some responses. These run at different
    // layers, so drift is invisible until traffic splits the wrong way.
    const vercel = JSON.parse(read("vercel.json")) as {
      headers?: { source: string; headers: { key: string; value: string }[] }[];
    };
    const bySource = new Map((vercel.headers ?? []).map((h) => [h.source, h.headers]));

    for (const path of POLLED) {
      const headers = bySource.get(path);
      expect(headers, `${path} is cached in next.config but not vercel.json`).toBeDefined();
      const cache = headers?.find((h) => h.key === "Cache-Control")?.value ?? "";
      expect(cache, `${path} lacks a shared TTL in vercel.json`).toMatch(/s-maxage=\d+/);
      expect(cache, `${path} must not be private`).toContain("public");
    }
  });
});

describe("the Cloudflare worker is shown the hottest request", () => {
  const worker = () => read("workers/edge-cache/src/index.mjs");

  it("caches the radio station list at the edge", () => {
    // Every listener's player refreshed this every 20 seconds and every one of
    // those landed on an origin function, because the worker had no rule for it.
    expect(worker()).toMatch(/test: \/\^\\\/api\\\/radio\\\/stations/);
  });

  it("keeps a snapshot so a cron tick serves it without hitting the origin", () => {
    const source = worker();
    expect(source).toContain('id: "radio-stations"');
    expect(source).toContain('path: "/api/radio/stations"');
    expect(source).toContain('if (pathname === "/api/radio/stations") return snapshotById("radio-stations")');
  });

  it("files every snapshot under a trigger the worker actually fires", () => {
    // A snapshot whose `trigger` names a cron the worker never runs would sit
    // permanently stale while looking configured — the copy is there, `/__edge`
    // reports a snapshot, and nothing ever rebuilds it. Checked for all of them
    // rather than just radio, because the next snapshot added would otherwise
    // inherit the same silence.
    const source = worker();
    const snapshotTriggers = [...source.matchAll(/id: "([a-z-]+)",[\s\S]{0,400}?trigger: "([a-z-]+)"/g)].map((m) => m[2]!);
    const cronTriggers = new Set([...source.matchAll(/cron: "[^"]+", trigger: "([a-z-]+)"/g)].map((m) => m[1]!));

    expect(snapshotTriggers.length).toBeGreaterThan(0);
    const orphans = snapshotTriggers.filter((t) => !cronTriggers.has(t));
    expect(orphans, `snapshot triggers with no cron: ${orphans.join(", ")}`).toEqual([]);
    expect(cronTriggers.has("radio-status-sweep")).toBe(true);
  });
});
