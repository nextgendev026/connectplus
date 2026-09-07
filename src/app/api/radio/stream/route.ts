import { NextRequest, NextResponse } from "next/server";
import { getStationById } from "@/lib/radio-stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PASS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ConnectPlus/1.0";

/**
 * Same-origin live-audio proxy. Browsers stream from OUR origin so we avoid
 * third-party cross-origin restrictions, bot/UA filters (e.g. Zeno 401s),
 * and hostname-level network blocking. Request:
 *
 *   GET /api/radio/stream?stationId=capital-fm
 */
export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId");
  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Unknown station" }, { status: 400 });
  }

  const upstream = station.streamUrl;
  let upstreamRes: Response;
  try {
    const ctrl = new AbortController();
    // Icecast/Shoutcast servers can take a while to negotiate; 25s covers
    // slow regional hosts without hanging the proxy forever.
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    upstreamRes = await fetch(upstream, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": PASS_UA,
        Accept: "*/*",
        "Icy-MetaData": "1",
      },
    });
    clearTimeout(timer);
  } catch {
    return NextResponse.json({ error: "Upstream unavailable" }, { status: 502 });
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    return NextResponse.json({ error: `Upstream error ${upstreamRes.status}` }, { status: 502 });
  }

  const contentType = upstreamRes.headers.get("content-type") ?? "audio/mpeg";

  // Note: Icy-Metaint (ICY metadata) cannot be preserved through a plain fetch
  // passthrough, so we hand back a clean audio stream without metadata.
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });

  const body = upstreamRes.body as unknown as ReadableStream<Uint8Array>;

  return new Response(body as unknown as BodyInit, { status: 200, headers });
}
