import { afterEach, describe, expect, it } from "vitest";
import { hasSharedSecret, isSharedSecret } from "@/lib/shared-secret";

/**
 * The shared-secret check behind every scheduler and drain route.
 *
 * The value of a test here is the two properties that a copy-pasted `===`
 * comparison could never hold: the compare does not leak the secret through
 * timing (pinned structurally, below), and an endpoint with no configured
 * secret is closed rather than open.
 */

const request = (headers: Record<string, string> = {}, query = "") =>
  ({ headers: new Headers(headers), nextUrl: new URL(`https://app.test/api/cron${query}`) }) as never;

const SECRET = "correct-horse-battery-staple";
const saved = process.env.CRON_SECRET;

afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe("shared secret", () => {
  it("accepts every carrier the schedulers are configured with", () => {
    process.env.CRON_SECRET = SECRET;
    expect(hasSharedSecret(request({ authorization: `Bearer ${SECRET}` }))).toBe(true);
    expect(hasSharedSecret(request({ "x-cron-secret": SECRET }))).toBe(true);
    expect(hasSharedSecret(request({}, `?key=${SECRET}`))).toBe(true);
    expect(hasSharedSecret(request({}, `?secret=${SECRET}`))).toBe(true);
  });

  it("rejects a wrong, truncated or padded secret", () => {
    process.env.CRON_SECRET = SECRET;
    expect(hasSharedSecret(request({ authorization: "Bearer nope" }))).toBe(false);
    expect(hasSharedSecret(request({ authorization: `Bearer ${SECRET.slice(0, -1)}` }))).toBe(false);
    expect(hasSharedSecret(request({ authorization: `Bearer ${SECRET}x` }))).toBe(false);
    // The scheme is not the credential: a bare value that *contains* the secret
    // somewhere in the middle is still wrong.
    expect(hasSharedSecret(request({ authorization: `Digest ${SECRET}` }))).toBe(false);
  });

  it("treats a missing or blank secret as a refusal, not an open door", () => {
    // The bug this pins: `if (secret && value === secret)` meant an unset
    // CRON_SECRET skipped the comparison entirely, and several routes relied on
    // whatever happened to gate them downstream.
    delete process.env.CRON_SECRET;
    expect(hasSharedSecret(request({ authorization: "Bearer anything" }))).toBe(false);
    expect(hasSharedSecret(request({}, "?key="))).toBe(false);
    expect(isSharedSecret("")).toBe(false);
    expect(isSharedSecret(null)).toBe(false);

    process.env.CRON_SECRET = "   ";
    expect(hasSharedSecret(request({ authorization: "Bearer    " }))).toBe(false);
  });

  it("compares without leaking the match position through timing", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "src/lib/shared-secret.ts"), "utf8");
    // Structural, because a timing assertion in a unit test is noise: what
    // matters is that the compare goes through the constant-time primitive and
    // that no `===` against a secret sneaks back in. Comments are stripped
    // first — this module's own prose names the comparison it replaced.
    const code = source
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).toContain("timingSafeEqual");
    expect(code).not.toMatch(/[=!]==\s*secret\b/);
  });
});
