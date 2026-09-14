import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/redis", () => ({
  cacheGet: vi.fn(async () => null),
  cacheSet: vi.fn(async () => {}),
  redisDel: vi.fn(async () => {}),
}));

const { DEFAULT_SITE_ORIGIN, SETTINGS_CATALOG, publicSiteOrigin } = await import("@/lib/settings");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicSiteOrigin", () => {
  it("keeps a real origin and drops the trailing slash", () => {
    expect(publicSiteOrigin("https://connectplus.co.ke/")).toBe("https://connectplus.co.ke");
  });

  it("never publishes a loopback origin when the deployment knows its own host", () => {
    // The live bug: a local run seeded `http://localhost:64691` into the shared
    // settings, so every canonical, sitemap entry and share card in production
    // pointed at a port on somebody's laptop.
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "connectplusapp.vercel.app");
    expect(publicSiteOrigin("http://localhost:64691")).toBe("https://connectplusapp.vercel.app");
    expect(publicSiteOrigin("http://localhost:3000")).toBe("https://connectplusapp.vercel.app");
    expect(publicSiteOrigin("http://127.0.0.1:3000")).toBe("https://connectplusapp.vercel.app");
  });

  it("treats private network addresses as local too", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "connectplusapp.vercel.app");
    expect(publicSiteOrigin("http://192.168.100.1:3000")).toBe("https://connectplusapp.vercel.app");
    expect(publicSiteOrigin("http://10.0.0.7")).toBe("https://connectplusapp.vercel.app");
    expect(publicSiteOrigin("http://172.20.4.9")).toBe("https://connectplusapp.vercel.app");
  });

  it("keeps loopback when nothing else is known, so local dev links still work", () => {
    expect(publicSiteOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("uses the project's stable domain rather than a per-deployment host", () => {
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "connectplusapp.vercel.app");
    vi.stubEnv("VERCEL_URL", "connectplus-7f3a91-nyash.vercel.app");
    // The per-deployment host changes on every push; a canonical that changes
    // with it is worse than useless.
    expect(publicSiteOrigin("http://localhost:64691")).toBe("https://connectplusapp.vercel.app");
  });

  it("falls back to the brand default rather than an empty string", () => {
    expect(publicSiteOrigin("")).toBe(DEFAULT_SITE_ORIGIN);
    expect(publicSiteOrigin(null)).toBe(DEFAULT_SITE_ORIGIN);
    expect(publicSiteOrigin(undefined)).toBe(DEFAULT_SITE_ORIGIN);
  });

  it("seeds the catalog default through the sanitizer, not straight from AUTH_URL", () => {
    const def = SETTINGS_CATALOG.find((d) => d.key === "siteUrl");
    expect(def?.defaultValue).toMatch(/^https?:\/\/\S+$/);

    // The wiring, pinned: the default is what seeded localhost into the live
    // settings in the first place, so a bare `process.env.AUTH_URL` here is the
    // regression to catch. Asserted against the source because the catalog is
    // built once at import time and cannot be re-evaluated per env.
    const source = readFileSync(join(process.cwd(), "src/lib/settings.ts"), "utf8");
    expect(source).toContain("defaultValue: publicSiteOrigin(process.env.AUTH_URL)");
    expect(source).not.toContain("defaultValue: process.env.AUTH_URL");
  });
});
