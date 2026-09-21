import { NextRequest, NextResponse } from "next/server";
import {
  getStationById,
  sourceAdRisk,
  sourceIsDirect,
  stationSources,
  type RadioStation,
} from "@/lib/radio-stations";
import { openValidatedStream } from "@/lib/radio-stream-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export interface ProbeResult {
  index: number;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  bitrateKbps: number | null;
  stationName: string | null;
  latencyMs: number | null;
}

const PROBE_TTL_MS = 5 * 60 * 1000;
const probeCache = new Map<string, { expiresAt: number; data: ProbeResult[] }>();

async function probeSource(url: string, timeoutMs = 7000): Promise<Omit<ProbeResult, "index">> {
  const started = Date.now();
  try {
    // Range request: enough to verify the channel speaks audio without
    // downloading the stream. Redirects are validated rather than followed —
    // see `radio-stream-guard`. The body is drained below and never kept.
    const opened = await openValidatedStream(url, {
      timeoutMs,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        Range: "bytes=0-4095",
      },
    });
    if (!opened.ok) {
      return { ok: false, status: null, contentType: null, bitrateKbps: null, stationName: null, latencyMs: null };
    }
    const res = opened.response;
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
      { stationId: station.id, best: bestIndex(station, hit.data), channels: hit.data },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
    );
  }

  const sources = stationSources(station);
  const channels: ProbeResult[] = [];
  for (const [index, url] of sources.entries()) {
    channels.push({ index, ...(await probeSource(url)) });
  }
  probeCache.set(station.id, { expiresAt: Date.now() + PROBE_TTL_MS, data: channels });

  return NextResponse.json(
    { stationId: station.id, best: bestIndex(station, channels), channels },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } }
  );
}

/**
 * The channel worth opening, now that the probe knows which ones actually answer.
 *
 * This used to be "the first that responds", which is not the same question: a
 * station whose channel 0 is a working-but-ad-injecting relay and whose channel 1
 * is the broadcaster's own 320 kbps mount would have been steered to the relay on
 * every visit. The ranking is the player's own (see `preferredSourceIndex`), with
 * the probe's measured quality substituted for the guess — ad risk first, then
 * whether the browser can take the mount directly, then bitrate, then the
 * station's curated order.
 */
function bestIndex(station: RadioStation, channels: ProbeResult[]): number {
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of channels) {
    if (!c.ok) continue;
    const quality = Math.min(c.bitrateKbps ?? 0, 5_000);
    const score =
      sourceAdRisk(station, c.index) * 1_000_000 +
      (sourceIsDirect(station, c.index) ? 0 : 100_000) +
      (5_000 - quality) * 10 +
      c.index;
    if (score < bestScore) {
      bestScore = score;
      best = c.index;
    }
  }
  // Nothing answered: fall back to the station's own preference order, so the
  // caller still gets a channel index rather than a silent zero.
  return best === -1 ? 0 : best;
}
