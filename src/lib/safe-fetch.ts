import { createLogger } from "@/lib/logger";

/**
 * Every outbound fetch of a URL we did not choose.
 *
 * RSS items, admin-learned pages, publisher thumbnails and search results are all
 * addresses supplied by someone else. Passing one straight to `fetch` makes the
 * server a proxy: `http://169.254.169.254/latest/meta-data/iam/security-credentials/`
 * is a URL like any other, and on a cloud host the application is the only thing
 * that can reach it. That is the whole attack — no parser bug required, just a
 * URL that the process is allowed to reach and the attacker is not.
 *
 * `redirect: "follow"` is a second hole, and the more insidious one: the URL we
 * validate is not the URL we fetch. A public, allowlisted-looking host can answer
 * `302 Location: http://10.0.0.5:6379/`, and the redirect is followed by the
 * runtime *after* our checks passed. So redirects are followed **manually**, one
 * hop at a time, re-validating each destination against the same rules.
 *
 * The rules, in the order they are applied:
 *
 *   1. **Scheme.** `http` and `https` only — `file:`, `gopher:`, `data:` and
 *      friends are refused. They are not web addresses, and one of them reads the
 *      filesystem.
 *   2. **Hostname.** Literal names for internal things (`localhost`, `*.internal`,
 *      the cloud metadata names) are refused by name, before any lookup.
 *   3. **Resolved address.** The host is resolved and *every* answer is checked,
 *      not the first: a name with one public A record and one private one is a
 *      bypass, and DNS answers are attacker-influenced by definition.
 *   4. **Redirects.** Each hop repeats 1–3, with a cap on the number of hops so a
 *      redirect loop cannot become a denial of service.
 *   5. **Content type and size.** A refused media type or an oversized body is a
 *      refusal, not a truncation — a caller that asked for HTML and received a
 *      gigabyte of video has been made to do someone else's work.
 *
 * What this deliberately does not do: allow a private address on purpose. There is
 * no `allowPrivate` escape hatch, because the moment one exists it gets used for
 * a local development convenience and then ships. If a future feature genuinely
 * needs an internal address, it should call `fetch` directly and say why in a
 * comment, not weaken this module for everyone.
 */

const log = createLogger("safe-fetch");

export type SafeFetchReason =
  | "invalid_url"
  | "scheme_not_allowed"
  | "host_blocked"
  | "address_blocked"
  | "too_many_redirects"
  | "redirect_without_location"
  | "content_type_not_allowed"
  | "too_large"
  | "timeout"
  | "unreachable"
  | "not_ok";

export type SafeFetchResult =
  | {
      ok: true;
      url: string;
      status: number;
      contentType: string | null;
      text: string;
      bytes: number;
      redirects: number;
    }
  | {
      ok: false;
      reason: SafeFetchReason;
      detail: string;
      /** The refusal's own status, for a caller that maps it onto a response. */
      status: number;
    };

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** Response media types the caller is prepared to handle. */
  accept?: readonly string[];
  maxRedirects?: number;
  method?: string;
  headers?: Record<string, string>;
  /** Injected for tests: DNS resolver. */
  resolve?: (hostname: string) => Promise<string[]>;
  /** Injected for tests: the actual transport. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_ACCEPT = ["text/html", "text/plain", "application/json", "application/xml", "text/xml", "application/rss+xml", "application/atom+xml"] as const;

/**
 * Names that are internal by convention.
 *
 * Checked before resolution because a hostname is a claim, not an address — and
 * because a resolver that is itself compromised, or a hosts-file entry, would
 * otherwise be the last word.
 */
const BLOCKED_HOSTNAMES = [
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "kubernetes.default",
  "kubernetes.default.svc",
] as const;

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".corp",
  ".home.arpa",
  ".cluster.local",
  ".svc",
  ".in-addr.arpa",
  ".ip6.arpa",
] as const;

/** IPv4 ranges that must never be reachable from a user-supplied URL. */
const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, includes 169.254.169.254 (cloud metadata)
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, includes 255.255.255.255
];

function v4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function inV4Range(address: string, base: string, bits: number): boolean {
  const a = v4ToInt(address);
  const b = v4ToInt(base);
  if (a === null || b === null) return false;
  // A /0 mask would shift by 32, which is undefined in JS; guard it.
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((a & mask) >>> 0) === ((b & mask) >>> 0);
}

/**
 * Is this IPv4 literal in a range we refuse?
 *
 * Exported because the refusal set is the interesting part of this module and a
 * test should be able to walk it without performing a request.
 */
export function isBlockedV4(address: string): boolean {
  return BLOCKED_V4.some(([base, bits]) => inV4Range(address, base, bits));
}

/** Expand an IPv6 literal to its eight 16-bit groups, or null if unparseable. */
function v6Groups(address: string): number[] | null {
  let value = address.trim().toLowerCase();

  // Strip a zone index (`fe80::1%eth0`) — it is a local scoping detail, and
  // leaving it in would make the string unparseable and therefore "not blocked".
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);

  if (!value.includes(":")) return null;

  // A trailing dotted quad (`::ffff:10.0.0.1`) is a real and commonly used form.
  const lastColon = value.lastIndexOf(":");
  const tail = value.slice(lastColon + 1);
  if (tail.includes(".")) {
    const embedded = v4ToInt(tail);
    if (embedded === null) return null;
    const high = Math.floor(embedded / 65536);
    const low = embedded % 65536;
    value = `${value.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      out.push(parseInt(group, 16));
    }
    return out;
  };

  const head = parse(halves[0] ?? "");
  const back = parse(halves[1] ?? "");
  if (!head || !back) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const missing = 8 - head.length - back.length;
  if (missing < 1) return null;
  return [...head, ...Array.from({ length: missing }, () => 0), ...back];
}

/** Is this IPv6 literal in a range we refuse? */
export function isBlockedV6(address: string): boolean {
  const groups = v6Groups(address);
  if (!groups) return false; // unparseable: handled by the literal check, not here
  const [g0 = 0, g1 = 0, g2 = 0] = groups;

  // ::1 loopback, :: unspecified
  const allZeroExceptLast = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
  if (allZeroExceptLast) return true;
  if (groups.every((g) => g === 0)) return true;

  // ::ffff:0:0/96 — IPv4-mapped. Judge the embedded v4, not the v6 wrapper,
  // because `::ffff:169.254.169.254` reaches the metadata service.
  if (g0 === 0 && g1 === 0 && g2 === 0 && groups[3] === 0 && groups[4] === 0 && groups[5] === 0xffff) {
    const embedded = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
    return isBlockedV4(embedded);
  }

  // ::a.b.c.d and ::a:b forms are still loopback-adjacent when the tail is small.
  if (groups.slice(0, 6).every((g) => g === 0) && !(groups[6] === 0 && groups[7] === 0)) {
    const embedded = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`;
    if (isBlockedV4(embedded)) return true;
  }

  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}

/** Any literal address, v4 or v6, that we refuse. */
export function isBlockedAddress(address: string): boolean {
  if (address.includes(":")) return isBlockedV6(address);
  return isBlockedV4(address);
}

/** A hostname refused by name, before resolution. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if ((BLOCKED_HOSTNAMES as readonly string[]).includes(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  // A bare single-label name is an internal short name on most networks.
  if (!host.includes(".") && !host.includes(":")) return true;
  return false;
}

/**
 * The browser-style IPv4 spellings a naive check misses.
 *
 * `http://2130706433/` is `127.0.0.1`, `http://127.1/` is too, and
 * `http://0x7f.1/` is as well. Node's URL parser normalises some of these but not
 * all, so anything that is not dotted-quad decimal is treated as suspicious
 * rather than resolved as a hostname.
 */
function isAmbiguousIpv4Literal(host: string): boolean {
  return /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

export interface UrlAssessment {
  ok: boolean;
  reason?: SafeFetchReason;
  detail?: string;
  url?: URL;
}

/**
 * The URL-only half of the checks: scheme and hostname.
 *
 * Split out so a caller can refuse early, and so the cheap rules are testable
 * without a resolver.
 */
export function assessUrl(raw: string): UrlAssessment {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid_url", detail: "Not a valid absolute URL" };
  }

  const protocol = url.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return { ok: false, reason: "scheme_not_allowed", detail: `Scheme "${protocol}" is not http(s)` };
  }

  // WHATWG `hostname` keeps the brackets on an IPv6 literal, so `[::1]` reached
  // the checks below *as* `[::1]`. That defeated all three of them at once and
  // the failure was silent: `isBlockedHostname` saw a string containing a colon
  // and stood down (a bare single-label name is the case it refuses),
  // `isAmbiguousIpv4Literal` only knows v4, and `isBlockedV6` returned false on
  // input it could not parse — with a comment claiming the literal check would
  // have caught it, which was not true. So `http://[::1]/`,
  // `http://[fd00::1]/` and, worst, `http://[::ffff:169.254.169.254]/` all
  // passed as public URLs. Stripping the brackets is the fix: every check below
  // is written for a bare address.
  const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isBlockedHostname(hostname)) {
    return { ok: false, reason: "host_blocked", detail: `Host "${hostname}" is internal` };
  }
  if (isAmbiguousIpv4Literal(hostname)) {
    return { ok: false, reason: "host_blocked", detail: `Host "${hostname}" is a non-canonical address literal` };
  }
  if (isBlockedAddress(hostname)) {
    return { ok: false, reason: "address_blocked", detail: `Address "${hostname}" is not publicly routable` };
  }

  return { ok: true, url };
}

/** Resolve a hostname to every address it answers with. */
async function defaultResolve(hostname: string): Promise<string[]> {
  // A literal needs no lookup, and must not trigger one.
  if (hostname.includes(":") || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return [hostname];
  const dns = await import("node:dns/promises");
  const answers = await dns.lookup(hostname, { all: true });
  return answers.map((a) => a.address);
}

function allowedType(contentType: string | null, accept: readonly string[]): boolean {
  if (!contentType) return true; // no declaration: the size cap still applies
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return accept.some((a) => type === a || (a.endsWith("/*") && type.startsWith(a.slice(0, -1))));
}

/**
 * Read a body with a hard ceiling.
 *
 * `await res.text()` on an endpoint that streams forever is an out-of-memory
 * denial of service, so the size limit is enforced *while* reading and not only
 * from the `Content-Length` header — which is a claim, and an optional one.
 */
async function readCapped(
  response: Response,
  maxBytes: number
): Promise<{ ok: true; text: string; bytes: number } | { ok: false; bytes: number }> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, bytes: declared };

  const body = response.body;
  if (!body) return { ok: true, text: "", bytes: 0 };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        // Deliberately **not** awaited. When a response body has been teed — by
        // `Response.clone()`, which undici does internally on some retries, and
        // which callers do routinely — cancelling one branch only settles once
        // the other branch is also cancelled. Awaiting it here therefore hangs
        // forever on a stream nobody else will ever read, turning a size refusal
        // into a stuck request. We are finished with the stream either way.
        void reader.cancel().catch(() => undefined);
        return { ok: false, bytes };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A reader with an outstanding read request cannot be released. Nothing
      // downstream depends on the lock being free — the stream is discarded.
    }
  }

  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged), bytes };
}

function refuse(reason: SafeFetchReason, detail: string, status = 400): SafeFetchResult {
  return { ok: false, reason, detail, status };
}

/**
 * Fetch a URL that someone else supplied, or refuse and say why.
 *
 * Never throws: every failure is a result, because "the publisher's site is down"
 * is an expected condition for an RSS importer and must not become a 500.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const accept = options.accept ?? DEFAULT_ACCEPT;
  const resolve = options.resolve ?? defaultResolve;
  const doFetch = options.fetchImpl ?? fetch;
  const deadline = Date.now() + timeoutMs;

  let current = rawUrl;
  let redirects = 0;

  for (;;) {
    const assessed = assessUrl(current);
    if (!assessed.ok) {
      log.warn("refused", { url: current.slice(0, 200), reason: assessed.reason, detail: assessed.detail });
      return refuse(assessed.reason!, assessed.detail!, 400);
    }
    const url = assessed.url!;

    let addresses: string[];
    try {
      addresses = await resolve(url.hostname);
    } catch {
      return refuse("unreachable", "The host could not be resolved", 502);
    }
    if (addresses.length === 0) return refuse("unreachable", "The host resolved to no address", 502);

    // Every answer, not the first: a name whose records include one private
    // address is a way in, and a resolver is not a trusted component.
    const blocked = addresses.find((address) => isBlockedAddress(address));
    if (blocked) {
      log.warn("refused after resolution", { hostname: url.hostname, address: blocked });
      return refuse("address_blocked", `Host "${url.hostname}" resolves to a non-public address`, 400);
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return refuse("timeout", "The request took too long", 504);

    let response: Response;
    try {
      response = await doFetch(url.toString(), {
        method: options.method ?? "GET",
        // Manual, so each hop is checked. See the note at the top.
        redirect: "manual",
        headers: { Accept: accept.join(", "), ...(options.headers ?? {}) },
        signal: AbortSignal.timeout(Math.max(1, remaining)),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      return refuse(timedOut ? "timeout" : "unreachable", timedOut ? "The request took too long" : "The host could not be reached", 504);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return refuse("redirect_without_location", "The server answered a redirect with no destination", 502);
      if (redirects >= maxRedirects) return refuse("too_many_redirects", `More than ${maxRedirects} redirects`, 508);
      redirects += 1;
      try {
        current = new URL(location, url).toString();
      } catch {
        return refuse("redirect_without_location", "The redirect destination was not a URL", 502);
      }
      continue; // loop validates the new destination from scratch
    }

    if (!response.ok) return refuse("not_ok", `The server answered ${response.status}`, 502);

    const contentType = response.headers.get("content-type");
    if (!allowedType(contentType, accept)) {
      return refuse("content_type_not_allowed", `Refused content type "${contentType}"`, 415);
    }

    const body = await readCapped(response, maxBytes);
    if (!body.ok) {
      return refuse("too_large", `The response exceeded ${maxBytes} bytes`, 413);
    }

    return {
      ok: true,
      url: url.toString(),
      status: response.status,
      contentType,
      text: body.text,
      bytes: body.bytes,
      redirects,
    };
  }
}

/** The common case: fetch a page and get its text, or nothing. */
export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<string | null> {
  const result = await safeFetch(rawUrl, options);
  return result.ok ? result.text : null;
}
