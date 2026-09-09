import { NextRequest, NextResponse } from "next/server";
import { getStationById } from "@/lib/radio-stations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Same-origin live-audio proxy. Browsers stream from OUR origin so we avoid
 * third-party cross-origin restrictions, bot/UA filters (e.g. Zeno 401s),
 * and hostname-level network blocking. Request:
 *
 *   GET /api/radio/stream?stationId=capital-fm
 *
 * AUDIO-FIDELITY CONTRACT (the previous version violated this and produced
 * static / crackle / cutouts):
 *
 * 1. NEVER send `Icy-MetaData: 1`. If we ask for ICY metadata, the upstream
 *    interleaves fixed-size metadata blocks into the audio at every
 *    `icy-metaint` byte interval. A raw pass-through of that body plays the
 *    metadata bytes as audio — periodic burst of noise. Some servers send
 *    metadata even when unprompted, so we also STRIP any interleaved blocks
 *    when the upstream declares `icy-metaint` (defense in depth).
 * 2. Pass the upstream bytes through RAW — no buffering, no transformation.
 *    Chunked re-encoding through Node is what caused stutter and pitch
 *    wobble before. We pipe the body stream 1:1.
 * 3. Send per-host headers so CDN gateways (StreamGuys/Zeno/Radiojar)
 *    negotiate the same high-bitrate session a browser gets, including the
 *    Referer some hosts gate on.
 */
export async function GET(request: NextRequest) {
  const stationId = request.nextUrl.searchParams.get("stationId");
  const station = getStationById(stationId);
  if (!station) {
    return NextResponse.json({ error: "Unknown station" }, { status: 400 });
  }

  let upstreamHost = "localhost";
  try {
    upstreamHost = new URL(station.streamUrl).hostname;
  } catch {
    // fall through with default host
  }

  const upstream = station.streamUrl;
  let upstreamRes: Response;
  try {
    const ctrl = new AbortController();
    // Icecast/Shoutcast servers can take a while to negotiate; 25s covers
    // slow regional hosts without hanging the proxy forever.
    const timer = setTimeout(() => ctrl.abort(), 25_000);
    // NOTE: no Icy-MetaData header at all — see contract note above.
    upstreamRes = await fetch(upstream, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept: "*/*",
        "Accept-Language": "en-US,en;q=0.9,sw;q=0.8",
        Referer: `https://${upstreamHost}/`,
        Origin: `https://${upstreamHost}`,
        Connection: "keep-alive",
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
  const icyBr = upstreamRes.headers.get("icy-br");
  const icyName = upstreamRes.headers.get("icy-name");
  const metaint = Number(upstreamRes.headers.get("icy-metaint") ?? "0");

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-transform",
    // Tell Vercel's edge not to buffer the response — buffering a live
    // stream adds latency and causes burst-then-starve playback.
    "X-Accel-Buffering": "no",
  });
  if (icyBr) headers.set("X-Audio-Bitrate-Kbps", icyBr);
  if (icyName) headers.set("X-Audio-Station", encodeURIComponent(icyName));

  let body: ReadableStream<Uint8Array> = upstreamRes.body as unknown as ReadableStream<Uint8Array>;

  // Defense in depth: if the upstream interleaves ICY metadata anyway,
  // strip the metadata blocks so raw audio bytes are all that remains.
  if (metaint > 0) {
    const METAIN = metaint;
    // Cross-chunk-safe state machine: `audioLeft` counts audio bytes to pass
    // through; `metaLen === -1` means "next byte is the metadata length
    // byte"; otherwise we are skipping `metaLen` metadata bytes. Handles
    // metadata blocks that span chunk boundaries exactly.
    let audioLeft = METAIN;
    let metaLen = -1;
    const strip = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        let idx = 0;
        while (idx < chunk.length) {
          if (metaLen >= 0) {
            const skip = Math.min(metaLen, chunk.length - idx);
            idx += skip;
            metaLen -= skip;
            if (metaLen === 0) {
              metaLen = -1;
              audioLeft = METAIN;
            }
            continue;
          }
          if (audioLeft === 0) {
            // Length byte: metadata byte-count = value * 16.
            metaLen = (chunk[idx] ?? 0) * 16;
            idx += 1;
            if (metaLen === 0) {
              metaLen = -1;
              audioLeft = METAIN;
            }
            continue;
          }
          const take = Math.min(audioLeft, chunk.length - idx);
          controller.enqueue(chunk.subarray(idx, idx + take));
          idx += take;
          audioLeft -= take;
        }
      },
    });
    body = body.pipeThrough(strip);
  }

  return new Response(body as unknown as BodyInit, { status: 200, headers });
}
