"use client";

import { cn } from "@/lib/utils";

/**
 * OptimizedImage — serves images through the optimization pipeline.
 *
 * For uploaded images (starting with /uploads/ or http), it generates a
 * <picture> element with WebP and JPEG variants via the /api/optimize route,
 * so modern browsers get the smaller format and legacy browsers get a fallback.
 *
 * For generated thumbnails (/api/thumb/), it passes through unchanged — those
 * are already SVG-based and optimised at paint time.
 *
 * The component is a thin wrapper: it does not fetch or process anything itself.
 * All the work happens in /api/optimize, which the browser calls transparently
 * when it parses the <source> elements.
 */

function optimizeUrl(url: string, preset: string, overrides?: { w?: number; h?: number; q?: number }): string {
  const params = new URLSearchParams({ url, preset });
  if (overrides?.w) params.set("w", String(overrides.w));
  if (overrides?.h) params.set("h", String(overrides.h));
  if (overrides?.q) params.set("q", String(overrides.q));
  return `/api/optimize?${params.toString()}`;
}

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  preset?: string;
  className?: string;
  /** Skip optimization for generated thumbnails or already-optimised images. */
  unoptimized?: boolean;
  /** Additional props passed to the underlying <img>. */
  [key: string]: unknown;
}

export default function OptimizedImage({
  src,
  alt,
  width,
  height,
  preset = "cover",
  className,
  unoptimized = false,
  ...rest
}: OptimizedImageProps) {
  // Generated thumbnails and data URIs should not be re-optimised.
  const shouldOptimize = !unoptimized && !src.startsWith("/api/thumb/") && !src.startsWith("data:");

  if (!shouldOptimize) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={cn("block object-cover", className)}
        {...rest}
      />
    );
  }

  const webpUrl = optimizeUrl(src, preset, { w: width, h: height });
  const jpegUrl = optimizeUrl(src, preset, { w: width, h: height, q: 80 });

  return (
    <picture>
      <source srcSet={webpUrl} type="image/webp" />
      <source srcSet={jpegUrl} type="image/jpeg" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={cn("block object-cover", className)}
        loading="lazy"
        decoding="async"
        {...rest}
      />
    </picture>
  );
}
