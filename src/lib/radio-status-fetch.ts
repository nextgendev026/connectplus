import { STATIONS } from "@/lib/radio-stations";
import type { RadioStation } from "@/lib/radio-stations";
import {
  parseIcecast,
  parseShoutcast7,
  parseShoutcastStats,
} from "@/lib/radio-status";
import { cacheGet, cacheSet } from "@/lib/redis";

export interface RadioStatus {
  stationId: string;
  song: string | null;
  listeners: number | null;
  meta: boolean;
  source: "icecast" | "shoutcast" | "currentsong" | "none";
}

export const RADIO_STATUS_CACHE_TTL = 60 * 15; // 15 min

export function statusCacheKey(stationId: string): string {
  return `radio:status:${stationId}`;
}

async function fetchText(url: string, timeoutMs = 5000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ConnectPlus Radio/1.0)",
        "Icy-MetaData": "1",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 200_000 ? text.slice(0, 200_000) : text;
  } catch {
    return null;
  }
}

/**
 * Fetch live metadata for one station from its stream server (Icecast /
 * Shoutcast / currentsong). Pure fetch — no caching. Callers decide whether
 * to persist (API route caches in-memory + Redis, Inngest sweep caches Redis).
 */
export async function fetchStationStatus(station: RadioStation): Promise<RadioStatus> {
  let origin: string;
  try {
    origin = new URL(station.streamUrl).origin;
  } catch {
    return { stationId: station.id, song: null, listeners: null, meta: false, source: "none" };
  }

  const mount = new URL(station.streamUrl).pathname || undefined;
  const shoutcastStatsUrl = `${origin}/stats?sid=1&json=1`;
  const statsUrl = `${origin}/7.html`;
  const icecastUrl = mount && mount !== "/" ? `${origin}/status-json.xsl?mount=${mount}` : `${origin}/status-json.xsl`;
  const songUrl = mount && mount !== "/" ? `${origin}/currentsong?mount=${mount}` : `${origin}/currentsong`;

  const candidates: Array<{ url: string; kind: RadioStatus["source"] }> = [
    { url: shoutcastStatsUrl, kind: "shoutcast" },
    { url: statsUrl, kind: "shoutcast" },
    { url: icecastUrl, kind: "icecast" },
    { url: songUrl, kind: "currentsong" },
  ];

  for (const candidate of candidates) {
    const body = await fetchText(candidate.url);
    if (!body) continue;

    if (candidate.kind === "shoutcast") {
      let parsed = parseShoutcastStats(body);
      if (!parsed.song && parsed.listeners === null && /^\s*\d+,/.test(body)) {
        parsed = parseShoutcast7(body);
      }
      if (parsed.song || parsed.listeners !== null) {
        return {
          stationId: station.id,
          song: parsed.song,
          listeners: parsed.listeners,
          meta: Boolean(parsed.song),
          source: "shoutcast",
        };
      }
      continue;
    }

    if (candidate.kind === "icecast") {
      const parsed = parseIcecast(body, mount);
      if (parsed.song || parsed.listeners !== null) {
        return {
          stationId: station.id,
          song: parsed.song,
          listeners: parsed.listeners,
          meta: Boolean(parsed.song),
          source: "icecast",
        };
      }
      continue;
    }

    if (candidate.kind === "currentsong" && body.trim()) {
      return {
        stationId: station.id,
        song: body.trim(),
        listeners: null,
        meta: true,
        source: "currentsong",
      };
    }
  }

  return { stationId: station.id, song: null, listeners: null, meta: false, source: "none" };
}

/** Read a cached status from Redis (written by the Inngest sweep). */
export async function getCachedStationStatus(stationId: string): Promise<RadioStatus | null> {
  return cacheGet<RadioStatus>(statusCacheKey(stationId));
}

/** Persist a status to Redis with a TTL. */
export async function setCachedStationStatus(status: RadioStatus): Promise<void> {
  await cacheSet(statusCacheKey(status.stationId), status, RADIO_STATUS_CACHE_TTL);
}

/**
 * Inngest sweep: refresh metadata for every station and warm the Redis cache.
 * Returns a summary so the run is observable in the Inngest dashboard.
 */
export async function sweepAllStationStatuses(): Promise<{
  total: number;
  live: number;
  withMeta: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let live = 0;
  let withMeta = 0;

  // Sequential with a small per-station timeout so free-tier servers aren't
  // hammered; one sweep every 15 min is plenty for metadata freshness.
  for (const station of STATIONS) {
    try {
      const status = await fetchStationStatus(station);
      if (status.source !== "none") live++;
      if (status.meta) withMeta++;
      await setCachedStationStatus(status);
    } catch {
      errors.push(station.id);
    }
  }

  return { total: STATIONS.length, live, withMeta, errors };
}