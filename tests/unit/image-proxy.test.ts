import { describe, expect, it } from "vitest";
import { allowedHostsFromEnv, isPrivateHost, resolveImageTarget } from "@/lib/image-proxy";

const ORIGIN = "https://connectplus.test";

describe("isPrivateHost", () => {
  it("blocks loopback, RFC1918, link-local and CGNAT addresses", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      expect(isPrivateHost(host), host).toBe(true);
    }
  });

  it("allows ordinary public hosts", () => {
    for (const host of ["cdn.example.com", "8.8.8.8", "172.32.0.1", "supabase.co"]) {
      expect(isPrivateHost(host), host).toBe(false);
    }
  });

  it("blocks IPv6 loopback and unique-local ranges", () => {
    expect(isPrivateHost("::1")).toBe(true);
    expect(isPrivateHost("[fd00::1]")).toBe(true);
    expect(isPrivateHost("fe80::1")).toBe(true);
    expect(isPrivateHost("2606:4700::1111")).toBe(false);
  });

  it("blocks internal TLDs", () => {
    expect(isPrivateHost("api.internal")).toBe(true);
    expect(isPrivateHost("printer.local")).toBe(true);
  });
});

describe("resolveImageTarget", () => {
  it("resolves a root-relative upload against the site origin", () => {
    const r = resolveImageTarget("/uploads/cover.png", { origin: ORIGIN });
    expect(r).toEqual({ ok: true, url: `${ORIGIN}/uploads/cover.png`, host: "connectplus.test" });
  });

  it("refuses a protocol-relative URL (which is not a local path)", () => {
    expect(resolveImageTarget("//evil.example/x.png", { origin: ORIGIN }).ok).toBe(false);
  });

  it("refuses non-http protocols", () => {
    expect(resolveImageTarget("file:///etc/passwd", { origin: ORIGIN }).ok).toBe(false);
    expect(resolveImageTarget("javascript:alert(1)", { origin: ORIGIN }).ok).toBe(false);
  });

  it("refuses the cloud metadata endpoint", () => {
    const r = resolveImageTarget("http://169.254.169.254/latest/meta-data/", { origin: ORIGIN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/private|loopback/i);
  });

  it("refuses unusual ports", () => {
    expect(resolveImageTarget("http://cdn.example.com:22/x.png", { origin: ORIGIN }).ok).toBe(false);
    expect(resolveImageTarget("https://cdn.example.com:8443/x.png", { origin: ORIGIN }).ok).toBe(false);
  });

  it("allows public https images when no allowlist is set", () => {
    const r = resolveImageTarget("https://images.publisher.example/a.jpg", { origin: ORIGIN });
    expect(r.ok).toBe(true);
  });

  it("honours an explicit allowlist when one is configured", () => {
    const allowedHosts = ["connectplus.test", "supabase.co"];
    expect(resolveImageTarget("https://connectplus.test/a.png", { origin: ORIGIN, allowedHosts }).ok).toBe(true);
    expect(resolveImageTarget("https://proj.supabase.co/a.png", { origin: ORIGIN, allowedHosts }).ok).toBe(true);
    const denied = resolveImageTarget("https://images.publisher.example/a.jpg", { origin: ORIGIN, allowedHosts });
    expect(denied.ok).toBe(false);
  });
});

describe("allowedHostsFromEnv", () => {
  it("parses, trims and lowercases a comma list", () => {
    expect(allowedHostsFromEnv(" Supabase.co , cdn.example.com ")).toEqual(["supabase.co", "cdn.example.com"]);
  });

  it("returns nothing for an unset value", () => {
    expect(allowedHostsFromEnv(undefined)).toEqual([]);
    expect(allowedHostsFromEnv("")).toEqual([]);
  });
});
