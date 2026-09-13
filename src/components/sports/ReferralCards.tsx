"use client";

import { useEffect, useState } from "react";
import { Gift, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Offer {
  id: string;
  name: string;
  slug: string;
  region: string | null;
  bonus: string | null;
  description: string | null;
  logoUrl: string | null;
  placement: string;
  ctaText: string;
  clickUrl: string;
}

/**
 * Betting partner offers for one placement.
 *
 * Impressions are recorded once per mount (per offer), and every click goes
 * through the tracked redirect route so the console can rank partners without
 * any third-party pixel. When no partner is configured the component renders
 * nothing at all — never a hollow "advertise here" frame.
 */
export default function ReferralCards({
  placement,
  matchId,
  layout = "stack",
  compact = false,
  className,
}: {
  placement: string;
  matchId?: string | null;
  layout?: "stack" | "row";
  compact?: boolean;
  className?: string;
}) {
  const [offers, setOffers] = useState<Offer[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/sports/referrals?placement=${encodeURIComponent(placement)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { offers: [] }))
      .then((data: { offers?: Offer[] }) => {
        if (!alive) return;
        const list = data.offers ?? [];
        setOffers(list);
        for (const offer of list) {
          void fetch("/api/sports/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            body: JSON.stringify({
              type: "referral_impression",
              referralId: offer.id,
              matchId: matchId ?? null,
            }),
          }).catch(() => {});
        }
      })
      .catch(() => {
        if (alive) setOffers([]);
      });
    return () => {
      alive = false;
    };
  }, [placement, matchId]);

  if (offers === null) {
    return (
      <div className={cn("flex items-center justify-center rounded-2xl border border-surface-800/60 py-6", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-surface-500" />
      </div>
    );
  }
  if (offers.length === 0) return null;

  return (
    <div
      className={cn(
        layout === "row" ? "flex flex-wrap gap-3" : "space-y-3",
        className
      )}
    >
      {offers.map((offer) => (
        <a
          key={offer.id}
          href={`${offer.clickUrl}${matchId ? `?match=${encodeURIComponent(matchId)}` : ""}`}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className={cn(
            "group flex items-center gap-3 rounded-2xl border border-emerald-500/25 bg-gradient-to-r from-emerald-500/10 to-transparent p-3 transition hover:border-emerald-400/50 hover:from-emerald-500/15",
            layout === "row" ? "min-w-[240px] flex-1" : ""
          )}
        >
          {offer.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={offer.logoUrl} alt={offer.name} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
              <Gift className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-surface-50">{offer.name}</p>
              {offer.region ? (
                <span className="rounded-full bg-surface-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-surface-400">
                  {offer.region}
                </span>
              ) : null}
            </div>
            {!compact && offer.bonus ? (
              <p className="truncate text-xs font-medium text-emerald-300">{offer.bonus}</p>
            ) : null}
            {!compact && offer.description ? (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-surface-400">{offer.description}</p>
            ) : null}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11px] font-semibold text-white">
            {offer.ctaText}
            <ExternalLink className="h-3 w-3" />
          </span>
        </a>
      ))}
      <p className="w-full pt-1 text-[10px] leading-relaxed text-surface-500">
        18+. Betting involves risk. Offers are third-party; play responsibly.
      </p>
    </div>
  );
}
