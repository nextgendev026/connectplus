/**
 * SSRF guard for the image-optimization proxy.
 *
 * The on-the-fly optimizer fetches a URL the *user* chooses (`/api/optimize?url=…`),
 * which is a textbook server-side request forgery surface: without a guard a
 * caller could ask the server to fetch `http://169.254.169.254/…` (cloud
 * instance metadata), `http://localhost:5432`, or an internal admin endpoint,
 * and read the response through the optimizer.
 *
 * The policy is deliberately allow-the-public-internet but block-everything-
 * private: covers legitimately live on publisher CDNs we cannot enumerate, so an
 * exhaustive allowlist would break them, but the private address space is never
 * a legitimate image host. `IMAGE_PROXY_ALLOWED_HOSTS` (comma-separated) tightens
 * this to an explicit allowlist for deployments that want it.
 *
 * Pure and dependency-free so the rules are unit-testable without a network.
 */

/** Hosts that must never be fetched, by literal name. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Ports an image proxy has any business reaching. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

function isIpv4Private(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true; // malformed → refuse
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this host"
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isIpv6Private(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  return (
    h === "::1" ||
    h === "::" ||
    h.startsWith("fc") ||
    h.startsWith("fd") || // unique local
    h.startsWith("fe80") || // link-local
    h.startsWith("::ffff:") // IPv4-mapped → re-check the tail
  );
}

/** True for any hostname that resolves only to non-public infrastructure. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host.endsWith(".localdomain") || host.endsWith(".home.arpa")) return true;
  if (/^\[?[0-9a-f:]+\]?$/.test(host) && isIpv6Private(host)) return true;
  return isIpv4Private(host);
}

export type ImageTarget =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: string };

/**
 * Decide whether a user-supplied `url` may be fetched, and normalise it.
 *
 * Root-relative paths are resolved against the site's own origin (that is how
 * our own uploads are addressed). Everything else must be an absolute http(s)
 * URL on a public host at a sane port, and — when `allowedHosts` is non-empty —
 * on one of those hosts.
 */
export function resolveImageTarget(
  raw: string,
  opts: { origin: string; allowedHosts?: readonly string[] }
): ImageTarget {
  const value = raw.trim();
  if (!value) return { ok: false, reason: "empty url" };

  let candidate = value;
  if (value.startsWith("/")) {
    // A protocol-relative `//evil.com/x` is NOT a root-relative path.
    if (value.startsWith("//")) return { ok: false, reason: "protocol-relative url" };
    candidate = new URL(value, opts.origin).toString();
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "only http(s) urls are allowed" };
  }
  if (!ALLOWED_PORTS.has(parsed.port)) {
    return { ok: false, reason: `port ${parsed.port} is not allowed` };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, reason: "private or loopback hosts are not allowed" };
  }

  const allowed = (opts.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0) {
    const host = parsed.hostname.toLowerCase();
    const permitted = allowed.some((a) => host === a || host.endsWith(`.${a}`));
    if (!permitted) return { ok: false, reason: "host is not on the image proxy allowlist" };
  }

  return { ok: true, url: parsed.toString(), host: parsed.hostname.toLowerCase() };
}

/**
 * Parse the `IMAGE_PROXY_ALLOWED_HOSTS` env value. Empty means "public internet,
 * minus private ranges" — see the module note.
 */
export function allowedHostsFromEnv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}
