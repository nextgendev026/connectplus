import { NextRequest, NextResponse } from "next/server";
import { optimizeImage, cacheHeaders, negotiatedFormat, PRESETS } from "@/lib/image-optimizer";
import { allowedHostsFromEnv, isPrivateHost, resolveImageTarget } from "@/lib/image-proxy";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const log = createLogger("optimize");

/**
 * On-the-fly image optimization route.
 *
 * Usage:
 *   GET /api/optimize?url=<image-url>&preset=cover&format=webp
 *   GET /api/optimize?url=<image-url>&w=400&h=300&q=80
 *
 * The route fetches the source image, optimises it according to the preset or
 * explicit dimensions, and returns the result with long-lived cache headers.
 * The client never sees the optimisation happening — it just gets a smaller
 * image.
 *
 * Why this exists alongside the upload-time optimisation:
 *   - RSS-imported images were not optimised at upload time.
 *   - Covers uploaded before the engine was deployed are still at full size.
 *
 * Security: the `url` parameter is user-chosen, so every fetch passes the SSRF
 * guard in `lib/image-proxy` — http(s) only, no private/loopback/link-local
 * targets, sane ports, and the redirect target is re-checked (a public host
 * must not be able to bounce us to `169.254.169.254`). The response body is
 * capped so a hostile URL cannot exhaust memory. `IMAGE_PROXY_ALLOWED_HOSTS`
 * narrows the reachable set to an explicit allowlist where a deployment wants
 * it.
 */

/** Hard ceiling on the bytes we will pull through the optimizer. */
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

/** Preset name → the cache policy that suits that surface. */
function cacheKindFor(preset: string): Parameters<typeof cacheHeaders>[0] {
  switch (preset) {
    case "avatar":
      return "avatar";
    case "thumbnail":
    case "adminThumb":
      return "thumbnail";
    case "og":
      return "og";
    case "story":
      return "story";
    default:
      return "cover";
  }
}

async function readCapped(res: Response, cap: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > cap ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const allowedHosts = allowedHostsFromEnv(process.env.IMAGE_PROXY_ALLOWED_HOSTS);
  const target = resolveImageTarget(url, { origin, allowedHosts });
  if (!target.ok) {
    log.warn("rejected image proxy target", { url, reason: target.reason });
    return NextResponse.json({ error: `Refused to fetch image: ${target.reason}` }, { status: 400 });
  }

  const presetName = searchParams.get("preset") ?? "cover";
  const preset =
    PRESETS[presetName] ??
    PRESETS.cover ?? {
      maxWidth: 1200,
      maxHeight: 630,
      quality: 82,
      sharpen: true,
      format: "webp" as const,
      stripMetadata: true,
    };

  // Allow explicit overrides for one-off optimisation.
  const maxWidth = searchParams.get("w") ? parseInt(searchParams.get("w")!, 10) : preset.maxWidth;
  const maxHeight = searchParams.get("h") ? parseInt(searchParams.get("h")!, 10) : preset.maxHeight;
  const quality = searchParams.get("q") ? parseInt(searchParams.get("q")!, 10) : preset.quality;
  const format = searchParams.get("format") ?? negotiatedFormat(request.headers.get("accept"), preset.format);

  const customPreset = {
    ...preset,
    maxWidth: Number.isFinite(maxWidth) ? maxWidth : preset.maxWidth,
    maxHeight: Number.isFinite(maxHeight) ? maxHeight : preset.maxHeight,
    quality: Number.isFinite(quality) ? Math.min(100, Math.max(1, quality)) : preset.quality,
    format: format as typeof preset.format,
  };

  try {
    const res = await fetch(target.url, {
      headers: { "User-Agent": "connectPlus-image-optimizer/1.0" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });

    // A public URL can redirect anywhere — including the cloud metadata
    // endpoint. Re-check where we actually landed before trusting the body.
    const finalHost = (() => {
      try {
        return new URL(res.url).hostname.toLowerCase();
      } catch {
        return target.host;
      }
    })();
    if (finalHost !== target.host && isPrivateHost(finalHost)) {
      log.warn("rejected image proxy redirect", { url, redirectedTo: finalHost });
      return NextResponse.json({ error: "Refused to fetch image" }, { status: 400 });
    }

    if (!res.ok) {
      log.warn("failed to fetch source image", { url, status: res.status });
      return NextResponse.json({ error: `Source image returned ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "URL does not point to an image" }, { status: 400 });
    }

    const inputBuffer = await readCapped(res, MAX_SOURCE_BYTES);
    if (!inputBuffer) {
      return NextResponse.json({ error: "Source image is too large" }, { status: 413 });
    }

    const result = await optimizeImage(inputBuffer, customPreset);

    const headers: Record<string, string> = {
      ...cacheHeaders(cacheKindFor(presetName)),
      "Content-Type": result.contentType,
      "Content-Length": String(result.bytes),
      // The response format depends on the Accept header, so shared caches must
      // key on it — otherwise a WebP could be handed to a client that asked for
      // JPEG.
      Vary: "Accept",
      "X-Original-Size": String(inputBuffer.length),
      "X-Optimized-Size": String(result.bytes),
      "X-Compression-Ratio":
        inputBuffer.length > 0 ? `${Math.round((1 - result.bytes / inputBuffer.length) * 100)}%` : "0%",
    };

    return new NextResponse(new Uint8Array(result.buffer), { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("optimization route failed", { url, error: message });
    return NextResponse.json({ error: "Optimization failed" }, { status: 500 });
  }
}
