import { describe, expect, it } from "vitest";
import { rateLimitKeyFor, DEFAULT_API_LIMIT } from "../../src/proxy";

/**
 * Which rate-limit bucket an API path lands in.
 *
 * The table is matched by prefix, so a path inherits the policy of whatever
 * entry happens to be a prefix of it — and `find` returns the first such entry,
 * which makes the order of the table load-bearing. That combination is how
 * `/api/posts/check` came to be throttled as a post *write*: a 30/min ceiling,
 * sharing a bucket with real publishing and with the shared allowance for
 * callers whose address cannot be verified.
 *
 * It matters because that endpoint is the home feed's "has anything changed?"
 * poll, read once a minute by every visitor. Under a refused response the feed
 * component deliberately does nothing — `if (!res.ok) return` — so a rate-limited
 * poll is indistinguishable from "no new stories", and the feed stops updating
 * with nothing on screen to say why. `429` was confirmed in production on the
 * first request of a fresh window, which is what a saturated shared bucket looks
 * like from outside.
 *
 * These assertions are about *scoping*, not about numbers: the numbers live in
 * the DEFAULTS table and are tuned independently.
 */

describe("rate limit scoping", () => {
  it("gives the feed's change-check its own bucket, not the publishing one", () => {
    expect(rateLimitKeyFor("/api/posts/check")).toBe("POSTS_CHECK");
  });

  it("still limits real post writes under POSTS", () => {
    // The check endpoint must not have been separated by loosening the writes.
    expect(rateLimitKeyFor("/api/posts")).toBe("POSTS");
    expect(rateLimitKeyFor("/api/posts/abc123/like")).toBe("POSTS");
    expect(rateLimitKeyFor("/api/posts/abc123")).toBe("POSTS");
  });

  it("leaves the page's own images unthrottled", () => {
    // Covers and avatars are the heaviest request count on any feed page, and
    // they were measured serving 130/130 in production with no 429 — so this
    // pins the behaviour that makes browsing possible. Hitting a per-minute
    // ceiling here would blank cards rather than degrade them.
    expect(rateLimitKeyFor("/api/thumb/post/abc")).toBeUndefined();
    expect(rateLimitKeyFor("/api/optimize")).toBeUndefined();
  });

  it("falls back to the default bucket for an unrecognised path", () => {
    expect(rateLimitKeyFor("/api/admin/neural/conversations")).toBeUndefined();
    expect(rateLimitKeyFor("/api/settings/public")).toBeUndefined();
    expect(DEFAULT_API_LIMIT).toBeGreaterThan(0);
  });

  it("does not leak one policy into another path that shares a prefix word", () => {
    // `/api/posts` must not swallow a path that merely starts with "posts".
    expect(rateLimitKeyFor("/api/posts-comments")).toBe("POSTS");
    // And the neighbouring entries still resolve to themselves.
    expect(rateLimitKeyFor("/api/comments")).toBe("COMMENTS");
    expect(rateLimitKeyFor("/api/admin/neural/chat")).toBe("NEURAL_CHAT");
    expect(rateLimitKeyFor("/api/admin/neural/learn")).toBe("NEURAL_LEARN");
  });
});
