import { assessUrl, type SafeFetchReason } from "@/lib/safe-fetch";

/**
 * The redirect-validating half of an outbound audio request.
 *
 * `safeFetch` cannot be used for the live radio path, and the reason is worth
 * writing down because the obvious fix is the wrong one: it reads the whole body
 * into a string under a byte cap, which is correct for a page and fatal for a
 * stream. A radio proxy must hand the browser a 1:1 byte stream that stays open
 * for minutes, so it needs the *validation* half of `safeFetch` — scheme, host,
 * redirect destinations — and none of the buffering half.
 *
 * So this module reuses `assessUrl` and implements the redirect walk explicitly,
 * with `redirect: "manual"`, so every hop is inspected before it is followed.
 */

export type StreamGuardFailure = {
  ok: false;
  reason: SafeFetchReason | "redirect_blocked";
  detail: string;
};

export type StreamGuardSuccess = {
  ok: true;
  /** The URL that actually answered — after any approved redirects. */
  url: string;
  response: Response;
  /** How many hops were followed, for the audit trail. */
  redirects: number;
};

const DEFAULT_MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 25_000;

/** Statuses that carry a `Location` and must be inspected rather than followed. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Refuse a stream URL before any connection is attempted.
 *
 * Cheap and synchronous, so a bad catalog entry costs nothing. Note what this
 * does *not* do: it does not resolve the hostname, so a public name that resolves
 * to a private address is not caught here. That is a real limit, stated rather
 * than implied — closing it needs a DNS check per hop, which is the next step for
 * this module and not a claim about the current one.
 */
export function guardStreamUrl(raw: string): { ok: true; url: string } | StreamGuardFailure {
  const assessment = assessUrl(raw);
  if (!assessment.ok || !assessment.url) {
    return {
      ok: false,
      reason: assessment.reason ?? "invalid_url",
      detail: assessment.detail ?? "stream URL was refused",
    };
  }
  return { ok: true, url: assessment.url.toString() };
}

/**
 * Open an upstream audio response, validating every redirect destination.
 *
 * `redirect: "follow"` was the previous behaviour and is the whole defect: the
 * platform makes the request from inside its own network, so a broadcast host
 * that answers `302` with `http://169.254.169.254/…` — through compromise, a
 * hijacked DNS answer, or a misconfiguration at the host — had that destination
 * followed and the body streamed straight back to the caller. The catalog is
 * hardcoded so this was never attacker-controlled, but "the third party is
 * honest" is a weaker footing than "we checked".
 *
 * The body is never buffered: the returned `Response` is handed to the caller
 * with its stream intact.
 */
export async function openValidatedStream(
  raw: string,
  options: {
    headers?: Record<string, string>;
    maxRedirects?: number;
    timeoutMs?: number;
    /** Injected for tests. */
    fetchImpl?: typeof fetch;
  } = {}
): Promise<StreamGuardSuccess | StreamGuardFailure> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;

  let current = raw;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const checked = guardStreamUrl(current);
    if (!checked.ok) {
      // On a redirect hop the message should say so: "blocked destination" and
      // "blocked *redirect* destination" are different incidents to an operator.
      return hop === 0
        ? checked
        : { ok: false, reason: "redirect_blocked", detail: `redirect ${hop} → ${checked.detail}` };
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response: Response;
    try {
      response = await doFetch(checked.url, {
        signal: ctrl.signal,
        // Manual, so a redirect is a decision rather than a fait accompli.
        redirect: "manual",
        headers: options.headers,
      });
    } catch (error) {
      return {
        ok: false,
        reason: "unreachable",
        detail: error instanceof Error ? error.message : "upstream request failed",
      };
    } finally {
      clearTimeout(timer);
    }

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { ok: true, url: checked.url, response, redirects: hop };
    }

    const location = response.headers.get("location");
    if (!location) {
      return { ok: false, reason: "redirect_without_location", detail: `upstream ${response.status} with no Location` };
    }

    // Relative locations are legal and resolve against the hop they came from —
    // which is also the point at which a relative `Location` could smuggle a
    // destination past a string check, so resolve it before assessing.
    let next: string;
    try {
      next = new URL(location, checked.url).toString();
    } catch {
      return { ok: false, reason: "redirect_blocked", detail: `unparseable Location: ${location}` };
    }

    // The body of a redirect response is never wanted; release it.
    await response.body?.cancel().catch(() => {});

    if (hop === maxRedirects) {
      return {
        ok: false,
        reason: "too_many_redirects",
        detail: `more than ${maxRedirects} redirects`,
      };
    }
    current = next;
  }

  return { ok: false, reason: "too_many_redirects", detail: `more than ${maxRedirects} redirects` };
}
