import { resolveSlot } from "@/lib/ads";
import AdUnit from "./AdUnit";

/**
 * A placement.
 *
 * Two tiers, in-house first:
 *   1. A first-party creative — our own content, no third-party script, no
 *      consent required, and the best value per impression.
 *   2. A configured network slot (AdSense / Meta / MGAN / custom) as a fallback,
 *      so a placement keeps earning when no direct campaign is live.
 * Renders nothing when neither exists, so pages never show an empty frame.
 *
 * This is a server component on purpose, and it must stay one that reads nothing
 * request-specific: calling `headers()` or `cookies()` here would make every page
 * carrying an ad dynamic, which would cost the edge cache tier on `/sports` and
 * `/radio`. It resolves *what the slot may show* — live, in schedule, targeted —
 * and hands the pool to `AdUnit`, which is where the per-reader decision (which
 * creative, how often, was it seen) belongs.
 *
 * `categories` is how a placement becomes contextual: pass the page's category
 * ids and a campaign can target them.
 */
export default async function AdSlot({
  slot,
  className,
  label = "Sponsored",
  categories,
}: {
  slot: string;
  className?: string;
  label?: string | null;
  categories?: string[];
}) {
  const resolution = await resolveSlot(slot, { categories }).catch(() => null);
  if (!resolution) return null;

  return <AdUnit slot={slot} resolution={resolution} className={className} label={label} />;
}
