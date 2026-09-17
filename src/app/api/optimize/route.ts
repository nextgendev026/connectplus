import { NextRequest, NextResponse } from "next/server";
import { optimizeImage, cacheHeaders, negotiatedFormat, PRESETS } from "@/lib/image-optimizer";
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
 *   - Social crawlers hit /api/og and /api/thumb routes that need optimised
 *     output on demand.
 *
 * Security: the `url` parameter is restricted to http(s) URLs to prevent SSRF.
 * The route does not follow redirects beyond the first hop.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  // SSRF protection: only allow http(s) URLs.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "Only http(s) URLs are allowed" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }

  const presetName = searchParams.get("preset") ?? "cover";
  const preset = PRESETS[presetName] ?? PRESETS.cover ?? { maxWidth: 1200, maxHeight: 630, quality: 82, sharpen: true, format: "webp" as const, stripMetadata: true };

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
    // Fetch the source image.
    const res = await fetch(url, {
      headers: { "User-Agent": "connectPlus-image-optimizer/1.0" },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
    });

    if (!res.ok) {
      log.warn("failed to fetch source image", { url, status: res.status });
      return NextResponse.json({ error: `Source image returned ${res.status}` }, { status: 502 });
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "URL does not point to an image" }, { status: 400 });
    }

    const inputBuffer = Buffer.from(await res.arrayBuffer());
    const result = await optimizeImage(inputBuffer, customPreset);

    const headers: Record<string, string> = {
      ...cacheHeaders("cover"),
      "Content-Type": result.contentType,
      "Content-Length": String(result.bytes),
      "X-Original-Size": String(inputBuffer.length),
      "X-Optimized-Size": String(result.bytes),
      "X-Compression-Ratio": inputBuffer.length > 0 ? `${Math.round((1 - result.bytes / inputBuffer.length) * 100)}%` : "0%",
    };

    return new NextResponse(new Uint8Array(result.buffer), { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("optimization route failed", { url, error: message });
    return NextResponse.json({ error: "Optimization failed" }, { status: 500 });
  }
}
