import { NextRequest, NextResponse } from "next/server";
import { getStationById } from "@/lib/radio-stations";
import {
  parseIcecast,
  parseShoutcast7,
  parseShoutcastStats,
} from "@/lib/radio-status";

export const runtime = "nodejs";
export const maxDuration = 30;

export interface RadioStatus {
  stationId: string;
  song: string | null;
  listeners: number | null;
  meta: boolean;
  source: "icecast" | "shoutcast" | "currentsong" | "none";
}

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { expiresAt: number; data: RadioStatus }>();

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

export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId");
  const force = request.nextUrl.searchParams.get("force") === "1";

  if (!stationId) {
    return NextResponse.json({ error: "stationId is required" }, { status: 400 });
  }

  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Unknown station" }, { status: 400 });
  }

  const respond = (partial: {
    song: string | null;
    listeners: number | null;
    meta: boolean;
    source: RadioStatus["source"];
  }) => {
    const data: RadioStatus = { stationId, ...partial };
    cache.set(station.id, { expiresAt: Date.now() + CACHE_TTL_MS, data });
    return NextResponse.json(data);
  };

  if (!force) {
    const hit = cache.get(station.id);
    if (hit && hit.expiresAt > Date.now()) {
      return NextResponse.json(hit.data);
    }
  }

  let origin: string;
  try {
    origin = new URL(station.streamUrl).origin;
  } catch {
    return respond({ song: null, listeners: null, meta: false, source: "none" });
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
        return respond({ song: parsed.song, listeners: parsed.listeners, meta: Boolean(parsed.song), source: "shoutcast" });
      }
      continue;
    }

    if (candidate.kind === "icecast") {
      const parsed = parseIcecast(body, mount);
      if (parsed.song || parsed.listeners !== null) {
        return respond({ song: parsed.song, listeners: parsed.listeners, meta: Boolean(parsed.song), source: "icecast" });
      }
      continue;
    }

    if (candidate.kind === "currentsong" && body.trim()) {
      return respond({ song: body.trim(), listeners: null, meta: true, source: "currentsong" });
    }
  }

  return respond({ song: null, listeners: null, meta: false, source: "none" });
}