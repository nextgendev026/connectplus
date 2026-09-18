import { describe, expect, it } from "vitest";
import {
  analyticsIdProblem,
  buildAnalyticsSnippet,
  sanitizeIntegrationHtml,
} from "@/lib/integration-scripts";

describe("buildAnalyticsSnippet", () => {
  it("generates the GA4 snippet for a valid measurement id", () => {
    const html = buildAnalyticsSnippet("ga4", "G-ABC123");
    expect(html).toContain("googletagmanager.com/gtag/js?id=G-ABC123");
    expect(html).toContain("gtag('config','G-ABC123')");
  });

  it("generates Plausible, Fathom and Umami snippets", () => {
    expect(buildAnalyticsSnippet("plausible", "connectplus.io")).toContain("plausible.io/js/script.js");
    expect(buildAnalyticsSnippet("fathom", "ABCDEFGH")).toContain("cdn.usefathom.com/script.js");
    expect(buildAnalyticsSnippet("umami", "8f2c1a44-0000-4444-8888-abcdefabcdef")).toContain("cloud.umami.is/script.js");
  });

  it("returns nothing for none, an empty id, or a wrong-format id", () => {
    expect(buildAnalyticsSnippet("none", "G-ABC")).toBe("");
    expect(buildAnalyticsSnippet("ga4", "")).toBe("");
    expect(buildAnalyticsSnippet("ga4", "not-an-id")).toBe("");
    expect(buildAnalyticsSnippet("plausible", "no-dot")).toBe("");
  });

  it("escapes the id so it cannot break out of the attribute", () => {
    const html = buildAnalyticsSnippet("plausible", 'x" onload="alert(1)"');
    expect(html).not.toContain('onload="alert(1)"');
  });
});

describe("analyticsIdProblem", () => {
  it("passes a provider-less config and a valid id", () => {
    expect(analyticsIdProblem("none", "")).toBeNull();
    expect(analyticsIdProblem("ga4", "G-ABC123")).toBeNull();
  });

  it("explains a missing or malformed id", () => {
    expect(analyticsIdProblem("ga4", "")).toMatch(/required/i);
    expect(analyticsIdProblem("ga4", "nope")).toMatch(/format/i);
  });
});

describe("sanitizeIntegrationHtml", () => {
  it("keeps an external script from an allowlisted host", () => {
    const { html, blocked } = sanitizeIntegrationHtml(
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>'
    );
    expect(html).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-1"');
    expect(blocked).toEqual([]);
  });

  it("strips inline JavaScript and says so", () => {
    const { html, blocked } = sanitizeIntegrationHtml("<script>alert(document.cookie)</script>");
    expect(html).not.toContain("alert");
    expect(blocked.join(" ")).toMatch(/inline JavaScript/i);
  });

  it("strips inline code even when a valid external script is present", () => {
    const { html, blocked } = sanitizeIntegrationHtml(
      '<script src="https://plausible.io/js/script.js"></script><script>steal()</script>'
    );
    expect(html).toContain("plausible.io/js/script.js");
    expect(html).not.toContain("steal()");
    expect(blocked.join(" ")).toMatch(/inline JavaScript/i);
  });

  it("refuses a script from a host that is not on the allowlist", () => {
    const { html, blocked } = sanitizeIntegrationHtml('<script src="https://evil.example/x.js"></script>');
    expect(html).toBe("");
    expect(blocked.join(" ")).toMatch(/allowlist/i);
  });

  it("refuses non-https and protocol-relative sources", () => {
    expect(sanitizeIntegrationHtml('<script src="http://evil.example/x.js"></script>').html).toBe("");
    expect(sanitizeIntegrationHtml('<script src="//evil.example/x.js"></script>').html).toBe("");
    expect(sanitizeIntegrationHtml('<script src="data:text/javascript,alert(1)"></script>').html).toBe("");
  });

  it("keeps a tracking pixel inside <noscript>", () => {
    const { html } = sanitizeIntegrationHtml(
      '<noscript><img src="https://www.facebook.com/tr?id=1" width="1" height="1" /></noscript>'
    );
    expect(html).toContain("<noscript>");
    expect(html).toContain("facebook.com/tr");
  });

  it("drops dangerous elements and inline event handlers", () => {
    const { html, blocked } = sanitizeIntegrationHtml(
      '<iframe src="https://evil.example"></iframe><img src="https://x.example/a.gif" onload="alert(1)">'
    );
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("onload");
    expect(blocked.join(" ")).toMatch(/disallowed element|event-handler/i);
  });

  it("neutralises a </script> breakout attempt", () => {
    const { html } = sanitizeIntegrationHtml(
      '<noscript><img src="https://x.example/a.gif"></noscript></script><script>alert(1)</script>'
    );
    expect(html).not.toMatch(/<\/script\s*>/i);
  });

  it("honours a custom allowlist", () => {
    const { html } = sanitizeIntegrationHtml('<script src="https://cdn.mine.example/a.js"></script>', {
      allowedHosts: ["mine.example"],
    });
    expect(html).toContain("cdn.mine.example");
  });
});
