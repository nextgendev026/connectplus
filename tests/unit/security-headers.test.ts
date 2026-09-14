import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Response-hardening contract.
 *
 * Headers are the one part of the security surface nobody notices breaking:
 * a policy that loses `object-src 'none'`, or a CSP that quietly re-grows
 * `'unsafe-eval'` in production, looks like nothing at all in a diff. These
 * assertions are structural (the config source, not a live response) because
 * the CSP is assembled per NODE_ENV and vitest is neither of the two
 * environments that ship.
 *
 * The set is written in two files on purpose — `next.config.mjs` for everything
 * Next serves, `vercel.json` for whatever Vercel answers before Next runs — so
 * the last test here pins the overlap instead of trusting a reviewer to notice
 * that only one of them was updated.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const nextConfig = read("next.config.mjs");
/**
 * The same config with comments stripped. Several of the assertions below name
 * exactly what the comments explain — `mode=block`, `upgrade-insecure-requests`,
 * `'unsafe-eval'` — so they have to read code, not prose.
 *
 * Both strips are anchored to the start of a line on purpose. `https://*` in
 * the connect-src list contains a literal `/*`, so an unanchored block-comment
 * strip opens a bogus comment there and swallows the rest of the array (this
 * test caught exactly that while it was being written); a `//` strip that is not
 * line-anchored cuts every URL in the same list in half.
 */
const nextCode = nextConfig
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");
const vercel = JSON.parse(read("vercel.json")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

/** Every header the wildcard rule sets, keyed lowercase. */
function vercelWildcard(): Map<string, string> {
  const rule = vercel.headers.find((h) => h.source === "/(.*)");
  expect(rule, "vercel.json needs its catch-all header rule").toBeDefined();
  return new Map((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe("security headers — next.config.mjs", () => {
  it("keeps the baseline hardening headers", () => {
    for (const header of [
      '{ key: "X-Content-Type-Options", value: "nosniff" }',
      '{ key: "X-Frame-Options", value: "SAMEORIGIN" }',
      '{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }',
      '{ key: "X-Permitted-Cross-Domain-Policies", value: "none" }',
      '{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }',
    ]) {
      expect(nextCode).toContain(header);
    }
  });

  it("disables the legacy XSS auditor instead of trusting its filter", () => {
    // `1; mode=block` was the old advice. The auditor is gone from every current
    // browser and its filter was itself an XSS vector, so "0" is the hardened
    // value — a reviewer "fixing" this back would be the regression.
    expect(nextCode).toContain('{ key: "X-XSS-Protection", value: "0" }');
    expect(nextCode).not.toContain("mode=block");
  });

  it("opts out of ad-topic inference", () => {
    const policy = nextCode.match(/Permissions-Policy[\s\S]*?value:\s*"([^"]+)"/)?.[1] ?? "";
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("browsing-topics=()");
    expect(policy).toContain("interest-cohort=()");
  });

  it("carries the directives that make the CSP a policy and not decoration", () => {
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "frame-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
    ]) {
      expect(nextCode, `CSP is missing ${directive}`).toContain(directive);
    }
  });

  it("keeps 'unsafe-eval' out of production", () => {
    // The dev-server HMR runtime needs it; the production runtime does not. The
    // exact template is asserted so the gate cannot be flattened to either side.
    expect(nextCode).toContain("`script-src 'self' 'unsafe-inline'${isDev ? \" 'unsafe-eval'\" : \"\"}`");
  });

  it("never upgrades insecure media, because some radio streams are http-only", () => {
    expect(nextCode).not.toContain("upgrade-insecure-requests");
    expect(nextCode).toContain("media-src 'self' blob: https: http:");
  });

  it("lets the board reach the edge worker it is pointed at", () => {
    // The bug this pins: the poll is cross-origin when NEXT_PUBLIC_EDGE_URL is
    // set, so a connect-src that only listed 'self' silently blocked the board.
    expect(nextCode).toContain("https://*.workers.dev");
    expect(nextCode).toContain("NEXT_PUBLIC_EDGE_URL");
  });

  it("only sends HSTS from production", () => {
    // Pinning localhost to https outlives the change that caused it, so the
    // header is behind the same environment gate as 'unsafe-eval'.
    expect(nextCode).toMatch(/if \(!isDev\) \{[\s\S]*?Strict-Transport-Security/);
    expect(nextCode).toContain("max-age=31536000; includeSubDomains");
  });
});

describe("security headers — vercel.json mirror", () => {
  it("repeats the transport-level headers for responses Next never sees", () => {
    const headers = vercelWildcard();
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("x-xss-protection")).toBe("0");
    expect(headers.get("x-permitted-cross-domain-policies")).toBe("none");
    expect(headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(headers.get("permissions-policy")).toContain("browsing-topics=()");
  });

  it("leaves the CSP to the one place that can build it per deployment", () => {
    // A second, hand-maintained policy would silently intersect with the real
    // one the first time either was edited.
    expect(vercelWildcard().has("content-security-policy")).toBe(false);
  });
});
