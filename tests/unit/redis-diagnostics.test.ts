import { describe, expect, it } from "vitest";
import { explainRedisError } from "@/lib/redis";

/**
 * Redis failure messaging.
 *
 * The cache layer swallows every error on purpose — a broken cache must never
 * break a page — which left the admin console able to say only "Probe write/read
 * failed". That is technically true and operationally useless: the real causes
 * (rotated password, TLS-only endpoint, bad hostname, wrong port) are each
 * distinguishable from the server's own error text, and the wrong-password case
 * is the one that actually happens.
 *
 * These messages are the difference between a five-minute fix and an afternoon.
 */

const TLS_URL = "rediss://default:secret@redis-1234.cloud.redislabs.com:17000";
const PLAIN_URL = "redis://default:secret@redis-1234.cloud.redislabs.com:17000";

describe("explainRedisError", () => {
  it("names wrong credentials as the cause and points at the password", () => {
    // The exact text ioredis surfaces for Redis Cloud's WRONGPASS.
    const message = explainRedisError("WRONGPASS invalid username-password pair", PLAIN_URL);
    expect(message).toMatch(/credentials rejected/i);
    expect(message).toMatch(/re-copy the password/i);
  });

  it("does not send a rejected credential to the TLS setting", () => {
    // WRONGPASS means the server *answered* and refused the password. The
    // transport already worked, so pointing at `rediss://` here sends an
    // operator to reconfigure something that is not broken — and they come back
    // with the same failure. A genuinely TLS-only endpoint fails with a TLS
    // error, which is handled separately below.
    // The word `rediss://` may legitimately appear — the message *names* the
    // scheme it observed. What must not appear is the instruction to switch.
    const imperative = /try rediss|switch|instead of|use rediss/i;
    expect(explainRedisError("WRONGPASS invalid username-password pair", PLAIN_URL)).not.toMatch(imperative);
    expect(explainRedisError("WRONGPASS invalid username-password pair", TLS_URL)).not.toMatch(imperative);
  });

  it("names the scheme the endpoint actually answered on", () => {
    // The useful fact is *which* transport reached the server, because it rules
    // host, port and scheme in, and leaves exactly one thing to check.
    expect(explainRedisError("WRONGPASS", PLAIN_URL)).toMatch(/over redis:\/\//);
    expect(explainRedisError("WRONGPASS", TLS_URL)).toMatch(/over rediss:\/\//);
  });

  it("recognises an auth-less URL hitting a password-protected server", () => {
    expect(explainRedisError("NOAUTH Authentication required", PLAIN_URL)).toMatch(/requires a password/i);
  });

  it("distinguishes DNS, port and timeout failures", () => {
    expect(explainRedisError("getaddrinfo ENOTFOUND bad.host", PLAIN_URL)).toMatch(/does not resolve/i);
    expect(explainRedisError("connect ECONNREFUSED 127.0.0.1:6379", PLAIN_URL)).toMatch(/check the port/i);
    expect(explainRedisError("ETIMEDOUT", PLAIN_URL)).toMatch(/timed out/i);
  });

  it("recognises TLS handshake failures", () => {
    expect(explainRedisError("unable to verify the first certificate", PLAIN_URL)).toMatch(/TLS problem/i);
  });

  it("falls back to the raw text rather than inventing a cause", () => {
    expect(explainRedisError("something unusual happened", PLAIN_URL)).toBe("something unusual happened");
  });

  it("never returns an empty detail", () => {
    expect(explainRedisError("", PLAIN_URL)).toMatch(/no error text/i);
    expect(explainRedisError("   ", PLAIN_URL)).toMatch(/no error text/i);
  });
});
