"use client";

import { useState, type ReactEventHandler } from "react";
import { cn } from "@/lib/utils";
import {
  optimizedImageSrc,
  fallbackSource,
  isOptimizable,
  responsiveSrcSet,
  sizesForPreset,
  widthsForPreset,
  type OptimizePresetName,
} from "@/lib/image-src";

/**
 * OptimizedImage — the single <img> the app uses for post covers and avatars.
 *
 * Every source is routed through `/api/optimize`, which resizes, compresses and
 * converts it to the best format the requesting browser accepts (AVIF → WebP →
 * JPEG) and returns it with long-lived cache headers. That is what shrinks the
 * RSS-imported and pre-optimizer covers that the upload-time pipeline never saw.
 *
 * Sources that are already optimal — generated `/api/thumb/…` covers, `data:`
 * URIs — pass through untouched, so nothing is ever optimized twice.
 *
 * Deliberately a raw <img> rather than next/image: the optimizer URL carries a
 * query string, which next/image's local-path optimizer refuses, and the server
 * already negotiates format and does the resizing.
 *
 * The responsive behaviour is ours instead. Every optimizable source gets a
 * `srcset` of four widths and a `sizes` that mirrors the layout it sits in, so a
 * phone fetches the 400px candidate of a cover rather than the 1200px one. A
 * caller that passes an explicit `width` is asking for exactly that size (an
 * avatar box, a fixed rail), so its srcset is left off — guessing there would
 * override a deliberate choice.
 */
interface OptimizedImageProps {
  src: string | null | undefined;
  alt: string;
  preset?: OptimizePresetName;
  width?: number;
  height?: number;
  quality?: number;
  /** Stretch to the parent box (the old next/image `fill` behaviour). */
  fill?: boolean;
  /** Load eagerly with high priority — for above-the-fold hero art. */
  priority?: boolean;
  /** Skip the optimizer entirely. */
  unoptimized?: boolean;
  /** Used when `src` is empty (e.g. an avatar fallback). */
  fallback?: string;
  /** Override the preset's default `sizes` for an unusual layout. */
  sizes?: string;
  /** Override the candidate widths. Pass `[]` to opt out of a srcset. */
  widths?: number[];
  className?: string;
  /** Additional props passed to the underlying <img>. */
  [key: string]: unknown;
}

export default function OptimizedImage({
  src,
  alt,
  preset = "cover",
  width,
  height,
  quality,
  fill = false,
  priority = false,
  // Read as `unoptimizedSrc` inside, so the resolution block below cannot be
  // misread as "this component is the unoptimized one".
  unoptimized: unoptimizedSrc = false,
  fallback,
  sizes,
  widths,
  className,
  ...rest
}: OptimizedImageProps) {
  const raw = src && String(src).trim() ? src : fallback;
  const resolved = unoptimizedSrc ? (raw ?? "") : optimizedImageSrc(raw, { preset, width, height, quality });

  /**
   * Sources that have already failed to load, in the order they were tried.
   *
   * An image can fail for reasons that have nothing to do with us: the
   * optimizer route can be over quota, a publisher can rotate a cover URL, a
   * proxy can time out. Any of those used to render as nothing at all, because
   * a broken `<img>` is silent. This gives every source one second chance at the
   * URL it was derived from — the raw publisher or upload URL, which needs no
   * server work — and only gives up after that has failed too.
   *
   * That ordering is the point: the failure people hit most is the *derived* URL
   * failing while the original is perfectly fine, which is exactly what happens
   * when an image optimizer runs out of quota. Retrying the original turns a
   * blank card into a heavier but correct one.
   */
  const [failed, setFailed] = useState<string[]>([]);

  const derivedFailed = failed.includes(resolved);
  const original = raw && raw !== resolved ? raw : "";
  // Optimized → original → nothing. The chain itself lives in `fallbackSource`
  // so its order is asserted in a test rather than inferred from this render.
  const current = fallbackSource(resolved, original, failed);

  if (!current) return null;

  // A responsive set only when the caller did not pin a width and did not opt
  // out; `width` means "this exact size", so offering others would fight it.
  const candidates = widths ?? (width ? [] : widthsForPreset(preset));
  const srcSet =
    unoptimizedSrc || derivedFailed || candidates.length < 2
      ? ""
      : responsiveSrcSet(raw, candidates, { preset, height, quality });

  // Only advertise lazy loading when the caller did not ask for priority; the
  // browser defaults to eager, so `loading` is omitted rather than set to "eager".
  const lazyProps = priority ? { fetchPriority: "high" as const } : { loading: "lazy" as const };

  // Destructured out of `rest` so a caller's own onError cannot replace the
  // fallback chain; theirs still runs, after ours has recorded the failure.
  const { onError: callerOnError, ...imgRest } = rest;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={current}
      alt={alt}
      srcSet={srcSet || undefined}
      sizes={srcSet ? (sizes ?? sizesForPreset(preset)) : undefined}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      decoding="async"
      {...lazyProps}
      data-optimized={isOptimizable(raw) && !unoptimizedSrc ? "true" : undefined}
      onError={(event) => {
        setFailed((prev) => (prev.includes(current) ? prev : [...prev, current]));
        if (typeof callerOnError === "function") {
          (callerOnError as ReactEventHandler<HTMLImageElement>)(event);
        }
      }}
      className={cn(fill ? "absolute inset-0 h-full w-full object-cover" : "block object-cover", className)}
      {...imgRest}
    />
  );
}
