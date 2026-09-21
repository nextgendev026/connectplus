import { describe, expect, it } from "vitest";

/**
 * The radio reconnect policy.
 *
 * The defect these replace was not a wrong number — the curve was right. It was
 * that nothing terminated: `retryCount` was incremented and never compared to a
 * maximum, so a station that was off the air was re-opened every sixty seconds
 * for as long as the page stayed up. The reason it went unnoticed is that the
 * only observation that would have revealed it was leaving a browser open for an
 * hour. Hence a pure function: the terminus is now a property with a name.
 */

const { attemptsRemaining, reconnectDelayMs, shouldRetry, MAX_RECONNECT_ATTEMPTS, RECONNECT_CEILING_MS, RECONNECT_FLOOR_MS } =
  await import("@/lib/radio-reconnect");

describe("reconnectDelayMs", () => {
  it("waits the floor before the first retry", () => {
    expect(reconnectDelayMs(0)).toBe(RECONNECT_FLOOR_MS);
  });

  it("doubles on each subsequent attempt", () => {
    expect(reconnectDelayMs(1)).toBe(16_000);
    expect(reconnectDelayMs(2)).toBe(32_000);
    expect(reconnectDelayMs(3)).toBe(60_000);
  });

  it("is monotonic — a later attempt never waits less", () => {
    // An out-of-order delay would reopen a session sooner than the previous one,
    // which is the tight loop this curve exists to avoid.
    for (let attempt = 1; attempt < 20; attempt += 1) {
      expect(reconnectDelayMs(attempt)).toBeGreaterThanOrEqual(reconnectDelayMs(attempt - 1));
    }
  });

  it("never exceeds the ceiling, however large the count", () => {
    for (const attempt of [5, 10, 50, 1_000, 10_000]) {
      expect(reconnectDelayMs(attempt)).toBe(RECONNECT_CEILING_MS);
    }
  });

  it("survives an absurd attempt count instead of returning Infinity or NaN", () => {
    // `2 ** 2000` is Infinity; a naive implementation would hand that to
    // setTimeout, which coerces it to a 1ms delay — i.e. the tightest possible
    // retry loop, produced by the guard meant to prevent one.
    const delay = reconnectDelayMs(2_000);
    expect(Number.isFinite(delay)).toBe(true);
    expect(delay).toBe(RECONNECT_CEILING_MS);
  });

  it.each([-1, -100, NaN, Infinity])("treats the nonsensical attempt %s as the first retry", (attempt) => {
    expect(reconnectDelayMs(attempt)).toBe(RECONNECT_FLOOR_MS);
  });

  it("floors a fractional attempt rather than emitting a fractional delay", () => {
    expect(reconnectDelayMs(1.9)).toBe(16_000);
  });
});

describe("shouldRetry", () => {
  it("allows every attempt up to the cap", () => {
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      expect(shouldRetry(attempt), `attempt ${attempt} should retry`).toBe(true);
    }
  });

  it("stops at the cap — the property that was missing", () => {
    expect(shouldRetry(MAX_RECONNECT_ATTEMPTS)).toBe(false);
    expect(shouldRetry(MAX_RECONNECT_ATTEMPTS + 1)).toBe(false);
    expect(shouldRetry(1_000)).toBe(false);
  });

  it("stays stopped as attempts accumulate", () => {
    // A rule that could flip back to true at a higher count would produce a loop
    // that resumes after appearing to give up.
    const states = Array.from({ length: 40 }, (_, attempt) => shouldRetry(attempt));
    const firstStop = states.indexOf(false);
    expect(firstStop).toBe(MAX_RECONNECT_ATTEMPTS);
    expect(states.slice(firstStop).every((s) => s === false)).toBe(true);
  });

  it("spends the whole backoff budget in about two minutes", () => {
    // The listener-facing consequence of the cap, asserted rather than assumed:
    // long enough to ride out a blip, short enough not to strand anyone.
    const totalMs = Array.from({ length: MAX_RECONNECT_ATTEMPTS }, (_, i) => reconnectDelayMs(i)).reduce(
      (sum, ms) => sum + ms,
      0
    );
    expect(totalMs).toBeGreaterThanOrEqual(120_000);
    expect(totalMs).toBeLessThanOrEqual(240_000);
  });
});

describe("attemptsRemaining", () => {
  it("counts down from the maximum", () => {
    expect(attemptsRemaining(0)).toBe(MAX_RECONNECT_ATTEMPTS);
    expect(attemptsRemaining(1)).toBe(MAX_RECONNECT_ATTEMPTS - 1);
  });

  it("never reports a negative count", () => {
    expect(attemptsRemaining(MAX_RECONNECT_ATTEMPTS)).toBe(0);
    expect(attemptsRemaining(MAX_RECONNECT_ATTEMPTS + 50)).toBe(0);
  });

  it("agrees with shouldRetry about when the last attempt is used", () => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(shouldRetry(attempt)).toBe(attemptsRemaining(attempt) > 0);
    }
  });
});
