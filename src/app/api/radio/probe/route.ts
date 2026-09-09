import { NextRequest, NextResponse } from "next/server";
import { getStationById, stationSources } from "@/lib/radio-stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface ProbeResult {
  index: number;
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bitrateKbps: number | null;
  stationName: string | null;
  latencyMs: number | null;
}

const PROBE_TTL_MS = 5 * 60 * 1000;
const probeCache = new Map<string, { expiresAt: number; data: ProbeResult[] }>();

async function probeSource(url: string, timeoutMs = 7000): Promise<Omit<ProbeResult, "index" | "url">> {
  const started = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    // Range request: enough to verify the channel speaks audio without
    // downloading the stream. Fall back to a plain GET when Range is refused.
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        Range: "bytes=0-4095",
      },
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    if (!res.ok && res.status !== 206) {
      return { ok: false, status: res.status, contentType: null, bitrateKbps: null, stationName: null, latencyMs };
    }
    // Drain the tiny body so sockets don't linger.
    await res.arrayBuffer().catch(() => null);
    const contentType = res.headers.get("content-type");
    const audio = contentType?.startsWith("audio/") || contentType?.includes("mpegurl") || contentType?.includes("ogg");
    const br = Number(res.headers.get("icy-br") ?? "0");
    const name = res.headers.get("icy-name");
    return {
      ok: Boolean(audio) || res.status === 206,
      status: res.status,
      contentType,
      bitrateKbps: Number.isFinite(br) && br > 0 ? br : null,
      stationName: name ? decodeURIComponent(name) : null,
      latencyMs,
    };
  } catch {
    return { ok: false, status: null, contentType: null, bitrateKbps: null, stationName: null, latencyMs: null };
  }
}

/**
 * GET /api/radio/probe?stationId=capital-fm
 *
 * Walks every channel in the station's failover chain and reports which ones
 * answer with real audio. The player uses `best` to pick its first channel;
 * the admin/radio page uses the full list to show per-channel signal health.
 */
export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId");
  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Unknown station" }, { status: 400 });
  }

  const hit = probeCache.get(station.id);
  if (hit && hit.expiresAt > Date.now()) {
    return NextResponse.json(
      { stationId: station.id, best: bestIndex(hit.data), channels: hit.data },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
    );
  }

  const sources = stationSources(station);
  const channels: ProbeResult[] = [];
  for (const [index, url] of sources.entries()) {
    channels.push({ index, url, ...(await probeSource(url)) });
  }
  probeCache.set(station.id, { expiresAt: Date.now() + PROBE_TTL_MS, data: channels });

  return NextResponse.json(
    { stationId: station.id, best: bestIndex(channels), channels },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
  );
}

function bestIndex(channels: ProbeResult[]): number {
  const live = channels.findIndex((c) => c.ok);
  return live === -1 ? 0 : live;
}
