import Link from "next/link";
import { pickAd, recordImpression, type AdCreative } from "@/lib/ads";
import { cn } from "@/lib/utils";

/**
 * In-house ad slot. Renders nothing when the slot is unmonetised, so pages
 * never show an empty frame. Impressions are counted server-side on render.
 */
export default async function AdSlot({
  slot,
  className,
  label = "Sponsored",
}: {
  slot: string;
  className?: string;
  label?: string | null;
}) {
  const ad = await pickAd(slot).catch(() => null);
  if (!ad) return null;

  recordImpression(ad.id);

  return (
    <aside
      aria-label={label ? `${label} — ${ad.name}` : ad.name}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-surface-200/70 bg-surface-100/60",
        "shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-brand-500/40",
        className
      )}
    >
      {label ? (
        <span className="absolute right-2 top-2 z-10 rounded-full bg-surface-900/70 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur">
          {label}
        </span>
      ) : null}

      {ad.format === "html" ? (
        <div className="w-full [&_iframe]:w-full [&_img]:w-full" dangerouslySetInnerHTML={{ __html: ad.html ?? "" }} />
      ) : (
        <AdImage ad={ad} />
      )}

      {ad.sponsor ? (
        <p className="px-3 py-2 text-[11px] font-medium text-surface-500">
          Sponsored by <span className="text-surface-700">{ad.sponsor}</span>
        </p>
      ) : null}
    </aside>
  );
}

function AdImage({ ad }: { ad: AdCreative }) {
  const href = `/api/ads/click/${ad.id}`;
  return (
    <Link href={href} target="_blank" rel="noopener sponsored" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={ad.imageUrl ?? ""}
        alt={ad.name}
        loading="lazy"
        decoding="async"
        className="h-auto w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
      />
    </Link>
  );
}
