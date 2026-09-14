import { describe, expect, it } from "vitest";
import {
  AD_PRONE_HOSTS,
  HD_FLOOR_KBPS,
  STATIONS,
  canPlayDirect,
  isHdStation,
  preferredSourceIndex,
  sourceAdRisk,
  sourceIsDirect,
  stationSources,
  type RadioStation,
} from "@/lib/radio-stations";

/**
 * The dial's invariants, and — on demand — its health.
 *
 * ## Why this file exists
 *
 * Two station entries shipped pointing at the wrong thing, and both looked
 * completely healthy from the outside. `5fm` (South Africa) answered 200 with
 * `audio/mpeg` and a plausible bitrate, and was in fact streaming *Darom 101.5*.
 * `nrg-radio` answered 404 on its primary mount while its declared fallback
 * served `KENYA1 FM KENYA`. Status codes and content types could not tell the
 * difference; the upstream's own name could. Nothing was watching, so both sat in
 * production until a listener noticed.
 *
 * There are two layers here.
 *
 *   • **Invariants** — cheap, offline, part of `npm test`. They pin what a data
 *     edit can silently break: unique ids, absolute URLs, the rule that an
 *     ad-free station must be reachable without our relay, and the fact that the
 *     two broken entries are gone rather than re-added by copy-paste.
 *
 *   • **The live sweep** — every mount on the dial is actually probed, and the
 *     upstream's name is compared with the station's own. It needs the network and
 *     takes about two minutes, so it runs on demand:
 *
 *         npm run radio:check
 *
 *     Run it after touching any URL in `radio-stations.ts` or `radio-adfree.ts`,
 *     and before blaming the player for anything.
 *
 * The sweep's calibration is deliberate and worth preserving: it distinguishes a
 * *hazard* from a *blemish*. A fallback that is down costs nothing (the chain is
 * only walked when the primary fails, and the primary is checked separately), so
 * it is a note. A mount serving a different station, or HTML, or half the bitrate
 * the dial advertises, is a failure — that is the class of defect this file was
 * written for, and the class that reached listeners. Reporting all three as "FAIL"
 * is what makes a check get ignored on the day it matters.
 */

/** Live probing is opt-in; `npm run radio:check` is the only thing that asks. */
const NETWORK = process.env.RADIO_CHECK_NETWORK === "1" || process.env.npm_lifecycle_event === "radio:check";

/**
 * Hosts that publish something other than a station name in `icy-name`.
 *
 * StreamTheWorld publishes callsigns (`CJKFM`, `METRO_FM`), Radiojar publishes its
 * own mount id, and the `serverse` host publishes the literal string "No Name" —
 * all legitimate mounts whose upstream name is simply not comparable with the
 * station's.
 */
const CALLSIGN_HOSTS = ["streamtheworld.com", "serverse.com", "mixlr.com", "radiojar.com"];

/**
 * TLS failures that mean "this host's certificate chain is incomplete".
 *
 * Radio Rwanda is the live example: its mount is healthy and answers instantly to
 * curl and to Chrome, but Node refuses it with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
 * because the server does not send the intermediate. That is worth knowing rather
 * than just failing on: browsers fetch the missing intermediate themselves (so
 * direct playback works), while our own proxy — which uses Node's fetch — can
 * never reach it, and the station must therefore never be made proxy-only.
 */
const TLS_CHAIN_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "CERT_HAS_EXPIRED",
]);

function errorCode(err: unknown): string {
  const cause = (err as { cause?: { code?: string } } | null)?.cause;
  return cause?.code ?? (err as { code?: string } | null)?.code ?? "";
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ") // "Groove Salad [SomaFM]" → "Groove Salad"
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Significant words in a name, dropping the boilerplate every station shares. */
const STOP_WORDS = new Set(["fm", "radio", "the", "am", "hits", "music", "live", "digital", "mix", "kenya"]);

function tokens(value: string): Set<string> {
  return new Set(normalizeName(value).split(" ").filter((t) => t.length > 2 && !STOP_WORDS.has(t)));
}

/** What `icy-name` says when it says nothing: Icecast's placeholder, and blanks. */
function hasNoUpstreamName(value: string | null): boolean {
  if (!value) return true;
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  return normalized === "" || normalized === "noname" || normalized === "unknown";
}

/**
 * Whether two upstream names could be the same station.
 *
 * Deliberately generous: a mount named "GalaxieRadio" or "fipjazz-hifi.aac" is
 * describing the same station as "Galaxie FM" and "FIP Jazz", and only a shared
 * word gives that away. Containment counts as a match, which is what lets those
 * pass — while "5FM" against "Darom 101.5" and "NRG Radio" against "KENYA1 FM"
 * share nothing at all, which is the whole reason the comparison exists.
 */
function namesAgree(stationName: string, upstreamName: string): boolean {
  const stationTokens = [...tokens(stationName)];
  const upstreamTokens = [...tokens(upstreamName)];
  if (stationTokens.length === 0 || upstreamTokens.length === 0) return true;
  return stationTokens.some((s) => upstreamTokens.some((u) => s === u || u.includes(s) || s.includes(u)));
}

function isCallsignHost(url: string): boolean {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return CALLSIGN_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/* ══════════════════════════════════════════════════════════════════════════
   INVARIANTS — offline, always run
   ══════════════════════════════════════════════════════════════════════════ */

describe("the dial's data is internally sound", () => {
  it("has no duplicate station ids", () => {
    const ids = STATIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every station a playable absolute URL and the fields the UI reads", () => {
    for (const s of STATIONS) {
      expect(s.streamUrl, `${s.id} streamUrl`).toMatch(/^https?:\/\//);
      for (const fallback of s.fallbacks ?? []) {
        expect(fallback, `${s.id} fallback`).toMatch(/^https?:\/\//);
      }
      // Every field the station card and the player render. An empty tagline or
      // genre does not crash anything — it renders a blank line on the dial.
      expect(s.name, `${s.id} name`).toBeTruthy();
      expect(s.country, `${s.id} country`).toBeTruthy();
      expect(s.city, `${s.id} city`).toBeTruthy();
      expect(s.region, `${s.id} region`).toBeTruthy();
      expect(s.genre, `${s.id} genre`).toBeTruthy();
      expect(s.tagline, `${s.id} tagline`).toBeTruthy();
      expect(s.frequency, `${s.id} frequency`).toBeTruthy();
      expect(s.color, `${s.id} color`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(s.icon, `${s.id} icon`).toBeTruthy();
      expect(Array.isArray(s.programming), `${s.id} programming`).toBe(true);
    }
  });

  it("keeps every ad-free station reachable without our relay", () => {
    // The whole point of the ad-free curation: a station that cannot be played
    // directly is a station our proxy has to fetch, and the proxy is the reason
    // every listener looked like one German datacenter to the stations that
    // geo-target their spots. An ad-free station that is http-only would be
    // ad-free but structurally stuck on the German route, so it does not ship.
    for (const s of STATIONS.filter((x) => x.adFree)) {
      expect(canPlayDirect(s.streamUrl), `${s.id} declares adFree but is not https`).toBe(true);
    }
  });

  it("declares a bitrate for every station it badges as HD", () => {
    for (const station of STATIONS.filter((s) => isHdStation(s))) {
      // A station with no measured bitrate cannot be HD — the badge would be a
      // claim rather than a reading.
      expect(station.bitrateKbps).toBeGreaterThanOrEqual(HD_FLOOR_KBPS);
    }
  });

  it("keeps the regional core first, and the ad-free roster on the dial", () => {
    expect(STATIONS[0]!.country).toBe("Kenya");
    expect(STATIONS.some((s) => s.adFree)).toBe(true);
    // skip()/next-station and the featured card both read STATIONS[0].
    expect(STATIONS[0]!.id).toBe("capital-fm");
  });
});

describe("station selection", () => {
  it("prefers a clean https mount over an ad-prone one, whatever the order", () => {
    const station: RadioStation = {
      id: "test",
      name: "Test FM",
      country: "Kenya",
      city: "Nairobi",
      region: "Nairobi",
      genre: "Pop / Hits",
      language: "English",
      frequency: "1 FM",
      // An ad-monetised relay listed first, the broadcaster's own https mount second.
      streamUrl: "http://stream.zeno.fm/abc123",
      fallbacks: ["https://atunwadigital.streamguys1.com/test"],
      color: "#000000",
      icon: "T",
      tagline: "Test",
      programming: [],
      favorite: false,
      verified: true,
    };
    expect(sourceAdRisk(station, 0)).toBeGreaterThan(0);
    expect(preferredSourceIndex(station)).toBe(1);
  });

  it("prefers the directly playable channel when ad risk ties", () => {
    const station: RadioStation = {
      id: "test-direct",
      name: "Test Direct",
      country: "Rwanda",
      city: "Kigali",
      region: "Kigali",
      genre: "Pop / Hits",
      language: "English",
      frequency: "2 FM",
      // http first (proxy-only), https second (direct): the direct one wins.
      streamUrl: "http://listen.example.rw:8080/",
      fallbacks: ["https://listen.example.rw/stream"],
      color: "#000000",
      icon: "T",
      tagline: "Test",
      programming: [],
      favorite: false,
      verified: true,
    };
    expect(preferredSourceIndex(station)).toBe(1);
    expect(sourceIsDirect(station, 1)).toBe(true);
    expect(sourceIsDirect(station, 0)).toBe(false);
  });

  it("treats only https as direct-playable", () => {
    expect(canPlayDirect("https://example.com/stream")).toBe(true);
    expect(canPlayDirect("http://example.com/stream")).toBe(false);
    expect(canPlayDirect("not a url")).toBe(false);
    expect(canPlayDirect("")).toBe(false);
  });

  it("flags the ad-insertion platform, not just the free relays", () => {
    // StreamTheWorld (Targetspot) sells geo-targeted audio spots — it is how a
    // listener in Nairobi ends up being read an advert chosen for Frankfurt.
    expect(AD_PRONE_HOSTS).toContain("streamtheworld.com");
    expect(AD_PRONE_HOSTS).toContain("zeno.fm");
    const metro = STATIONS.find((s) => s.id === "metro-fm")!;
    expect(sourceAdRisk(metro, 0)).toBe(2);
  });
});

describe("stations that were serving the wrong thing stay removed", () => {
  it("does not carry NRG Radio or 5FM until a mount can be verified", () => {
    // NRG: primary 404, fallback served KENYA1 FM. 5FM: served Darom 101.5. Both
    // were re-added once already by copy-paste; this is the pin that makes the
    // third attempt deliberate.
    expect(STATIONS.find((s) => s.id === "nrg-radio")).toBeUndefined();
    expect(STATIONS.find((s) => s.id === "5fm")).toBeUndefined();
  });

  it("does not carry a second BBC card for a stream that redirects to bbc.co.uk", () => {
    expect(STATIONS.find((s) => s.id === "bbc-east-africa")).toBeUndefined();
    expect(STATIONS.find((s) => s.id === "bbc-world")).toBeDefined();
  });

  it("still carries the two national stations it was advertising but missing", () => {
    expect(STATIONS.find((s) => s.id === "radio-citizen")?.official).toBe(true);
    expect(STATIONS.find((s) => s.id === "radio-jambo")?.official).toBe(true);
  });

  it("names KBC for the service its mount actually serves", () => {
    expect(STATIONS.find((s) => s.id === "kbc-english")?.name).toBe("KBC Radio Taifa");
  });

  it("carries no fallback that is known to be another station", () => {
    // Both of these were found by the live sweep: NRG Uganda's Zeno fallback
    // served Next Radio, and Radio Rwanda's served Heaven FM. A fallback that
    // substitutes one station for another is worse than none at all.
    const nrgUg = STATIONS.find((s) => s.id === "nrg-uganda")!;
    const rwanda = STATIONS.find((s) => s.id === "radio-rwanda")!;
    expect(nrgUg.fallbacks ?? []).not.toContain("https://stream.zeno.fm/lbca7zintcnuv");
    expect(rwanda.fallbacks ?? []).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE LIVE SWEEP — `npm run radio:check`
   ══════════════════════════════════════════════════════════════════════════ */

interface ChannelFinding {
  station: string;
  index: number;
  url: string;
  status: number | null;
  bitrateKbps: number | null;
  upstreamName: string | null;
  /** Defects worth re-sourcing a mount for. */
  problems: string[];
  /** Things worth knowing that do not break the dial. */
  notes: string[];
}

async function probeChannelOnce(station: RadioStation, index: number, url: string): Promise<ChannelFinding> {
  const finding: ChannelFinding = {
    station: station.name,
    index,
    url,
    status: null,
    bitrateKbps: null,
    upstreamName: null,
    problems: [],
    notes: [],
  };
  const isFallback = index > 0;
  const stationIsDirect = canPlayDirect(station.streamUrl);

  // A range request is enough to make the server speak: headers plus a few bytes,
  // without downloading every stream on the dial.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        Range: "bytes=0-2047",
      },
    });
    finding.status = res.status;
    const type = res.headers.get("content-type") ?? "";
    const br = Number(res.headers.get("icy-br") ?? "0");
    finding.bitrateKbps = Number.isFinite(br) && br > 0 ? br : null;
    finding.upstreamName = res.headers.get("icy-name");
    await res.arrayBuffer().catch(() => null);

    const servingAudio = type.startsWith("audio/") || type.includes("ogg") || type.includes("mpegurl");

    if (!res.ok && res.status !== 206) {
      // A fallback that is simply down is a blemish, not a hazard: the chain is
      // only walked when the primary has already failed.
      (isFallback ? finding.notes : finding.problems).push(`HTTP ${res.status}`);
    } else if (!servingAudio) {
      // Answering with HTML is a hazard on either route — it is how a
      // Shoutcast web-player page gets played instead of the station.
      finding.problems.push(`not audio (${type || "no content-type"})`);
    }

    // Only the primary mount carries the dial's declared quality.
    //
    // The 10% tolerance is measurement noise, not politeness: the Atunwa mounts
    // report 127 kbps for a 128 kbps stream and 63 for a 64, flickering between
    // requests on the same mount. What this must catch is a mount that has DROPPED
    // A TIER (128 → 64), which 10% separates cleanly from codec rounding.
    if (index === 0 && station.bitrateKbps && finding.bitrateKbps !== null) {
      const floor = Math.floor(station.bitrateKbps * 0.9);
      if (finding.bitrateKbps < floor) {
        finding.problems.push(`serving ${finding.bitrateKbps} kbps, dial declares ${station.bitrateKbps}`);
      }
    }

    // Identity: the check that would have caught 5FM → Darom 101.5 and NRG →
    // KENYA1 FM. Skipped where the host publishes a callsign or a placeholder.
    if (!hasNoUpstreamName(finding.upstreamName) && !isCallsignHost(url)) {
      if (!namesAgree(station.name, finding.upstreamName!)) {
        finding.problems.push(`serving "${finding.upstreamName}" — a different station`);
      }
    }
  } catch (err) {
    const code = errorCode(err);
    const aborted = err instanceof Error && err.name === "AbortError";
    if (TLS_CHAIN_CODES.has(code)) {
      // Reachable by a browser, unreachable by Node's fetch. That is fine for
      // direct playback and fatal for a proxied one, so it is a note while the
      // station is https and a failure the moment it is not.
      const message = `TLS chain incomplete (${code}) — browsers can, our proxy cannot`;
      (stationIsDirect ? finding.notes : finding.problems).push(message);
    } else {
      (isFallback ? finding.notes : finding.problems).push(aborted ? "timed out" : `unreachable (${code || "network error"})`);
    }
  } finally {
    clearTimeout(timer);
  }

  return finding;
}

/**
 * Probe, and retry once when the mount looks broken.
 *
 * The regional hosts on this dial are small Icecast/Shoutcast servers, and a
 * single probe is genuinely noisy: a StreamGuys edge answered 502 under the load
 * of a 40-station sweep and was fine moments later. One retry separates "this
 * mount is dead" from "this mount blinked", which is the difference between a
 * signal worth acting on and a check nobody trusts.
 */
async function probeChannel(station: RadioStation, index: number, url: string): Promise<ChannelFinding> {
  const first = await probeChannelOnce(station, index, url);
  if (first.problems.length === 0) return first;
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const second = await probeChannelOnce(station, index, url);
  if (second.problems.length === 0) {
    return { ...second, notes: [...new Set([...first.notes, ...second.notes])] };
  }
  return {
    ...second,
    problems: [...new Set([...first.problems, ...second.problems])],
    notes: [...new Set([...first.notes, ...second.notes])],
  };
}

describe.runIf(NETWORK)("live dial sweep", () => {
  it(
    "every mount answers with audio, at its declared quality, from the right station",
    { timeout: 300_000 },
    async () => {
      const findings: ChannelFinding[] = [];
      // Deliberately gentle: three at a time, with a pause between batches. A
      // five-at-once sweep produced failures that were OUR fault rather than the
      // mounts' — a StreamGuys edge answering 502 under load block, and a small
      // Rwandan Icecast timing out while other probes held the pipe.
      const CONCURRENCY = 3;
      const BATCH_PAUSE_MS = 750;
      const jobs = STATIONS.flatMap((station) =>
        stationSources(station).map((url, index) => ({ station, index, url }))
      );

      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        const batch = jobs.slice(i, i + CONCURRENCY);
        findings.push(...(await Promise.all(batch.map((j) => probeChannel(j.station, j.index, j.url)))));
        if (i + CONCURRENCY < jobs.length) await new Promise((r) => setTimeout(r, BATCH_PAUSE_MS));
      }

      // The table is the point of the run — it is what a human reads to decide
      // which mount needs re-sourcing.
      const rows = findings.map((f) => {
        const verdict = f.problems.length ? "FAIL" : f.notes.length ? "note" : " ok ";
        const detail = [...f.problems, ...f.notes].join("; ");
        return (
          `${verdict}  ${`${f.station} [${f.index}]`.padEnd(38)} ` +
          `${String(f.bitrateKbps ?? "-").padStart(4)} kbps  ${(f.upstreamName ?? "").slice(0, 26).padEnd(26)}  ` +
          `${f.url}${detail ? `  ← ${detail}` : ""}`
        );
      });
      console.log(["\n", ...rows, ""].join("\n"));

      const failed = findings.filter((f) => f.problems.length > 0);
      expect(
        failed.map((f) => `${f.station} [${f.index}] ${f.url}: ${f.problems.join("; ")}`),
        "mounts that need re-sourcing"
      ).toEqual([]);
    }
  );
});
