/**
 * Ad selection — the pure half of the pipeline.
 *
 * Deliberately free of I/O: no Prisma, no Redis, no Convex. The server decides
 * *eligibility* (live, scheduled, targeted) and the browser decides *which* of
 * the eligible creatives this reader sees. That split is forced by reality
 * rather than taste — the pages carrying ads are prerendered and edge-cached
 * (`/sports`, `/radio`), so a server-side per-visitor pick would either be a
 * lie shared by every reader or would force those pages dynamic and cost the
 * cache tier the whole codebase works to keep.
 *
 * Keeping the decision here also means the rules are testable without a
 * database, which is the only way they stay honest.
 */

export const AD_SLOTS = [
  // Feed
  "feed-top",
  "feed-inline",
  "feed-sidebar",
  // Article
  "article-top",
  "article-inline",
  "article-bottom",
  "article-sidebar",
  "article-sticky",
  // Radio
  "radio-hero",
  "radio-inline",
  // Sports
  "sports-hero",
  "sports-inline",
  "sports-sidebar",
  // Browse
  "search-inline",
  "profile-inline",
  "categories-top",
  // Site-wide
  "global-anchor",
] as const;

export type AdSlotName = (typeof AD_SLOTS)[number];

export const AD_SLOT_LABELS: Record<string, string> = {
  "feed-top": "Feed — above the first card",
  "feed-inline": "Feed — between cards",
  "feed-sidebar": "Feed — sidebar",
  "article-top": "Article — above the fold",
  "article-inline": "Article — mid-content",
  "article-bottom": "Article — end of story",
  "article-sidebar": "Article — sidebar",
  "article-sticky": "Article — sticky sidebar",
  "radio-hero": "Radio — hero panel",
  "radio-inline": "Radio — between stations",
  "sports-hero": "Sports — hero panel",
  "sports-inline": "Sports — between fixtures",
  "sports-sidebar": "Sports — sidebar rail",
  "search-inline": "Search — between results",
  "profile-inline": "Profile — between posts",
  "categories-top": "Categories — above the grid",
  "global-anchor": "Site-wide — dismissible mobile anchor",
};

export type AdDevice = "mobile" | "tablet" | "desktop";

export interface AdSlotHint {
  /**
   * Reserved height in pixels. Holding the box before the creative loads is the
   * difference between a page that settles and one that shoves the paragraph a
   * reader is mid-sentence through down the screen.
   */
  minHeight: number;
  /** Restricts the format to where it belongs. Unset means everywhere. */
  device?: AdDevice;
  /** Follows the reader down the page rather than scrolling away. */
  sticky?: boolean;
  /** Sits against the bottom of the viewport until dismissed. */
  anchor?: boolean;
}

export const AD_SLOT_HINTS: Record<AdSlotName, AdSlotHint> = {
  "feed-top": { minHeight: 120 },
  "feed-inline": { minHeight: 120 },
  "feed-sidebar": { minHeight: 250 },
  "article-top": { minHeight: 120 },
  "article-inline": { minHeight: 120 },
  "article-bottom": { minHeight: 120 },
  "article-sidebar": { minHeight: 250 },
  "article-sticky": { minHeight: 250, device: "desktop", sticky: true },
  "radio-hero": { minHeight: 120 },
  "radio-inline": { minHeight: 100 },
  "sports-hero": { minHeight: 120 },
  "sports-inline": { minHeight: 120 },
  "sports-sidebar": { minHeight: 250 },
  "search-inline": { minHeight: 120 },
  "profile-inline": { minHeight: 120 },
  "categories-top": { minHeight: 120 },
  "global-anchor": { minHeight: 64, device: "mobile", anchor: true },
};

/** How often the same creative may be shown to one reader in a day. */
export const DEFAULT_FREQUENCY_CAP = 3;

export function isAdSlot(value: string): value is AdSlotName {
  return (AD_SLOTS as readonly string[]).includes(value);
}

export function slotHint(slot: string): AdSlotHint {
  return isAdSlot(slot) ? AD_SLOT_HINTS[slot] : { minHeight: 0 };
}

/** The height a page should reserve for a slot before the creative arrives. */
export function slotMinHeight(slot: string): number {
  return slotHint(slot).minHeight;
}

/**
 * Device class from a viewport width.
 *
 * Width rather than user agent: the question the placement actually asks is
 * "is there room for this format here", and a narrow desktop window answers it
 * better than a UA string that lies about tablets.
 */
export function deviceFromWidth(width: number): AdDevice {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

/** True when the slot's format is allowed on this device. */
export function slotAllowsDevice(slot: string, device: AdDevice): boolean {
  const allowed = slotHint(slot).device;
  if (!allowed) return true;
  if (allowed === "desktop") return device === "desktop" || device === "tablet";
  return device === allowed;
}

/* ── Targeting ────────────────────────────────────────────────────────────── */

/**
 * Parse a targeting field.
 *
 * Accepts a JSON array or a plain comma-separated list, because an admin typing
 * "Technology, Business" into a text field means the same thing as the array,
 * and rejecting it would look like the field did nothing.
 */
export function parseTargetList(value: string | null | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((v): v is string => typeof v === "string")
          .map((v) => v.trim().toLowerCase())
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return trimmed.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
}

/** Normalise a targeting field for storage. Empty means "target nothing". */
export function normalizeTargetList(value: string | null | undefined): string | null {
  const list = parseTargetList(value);
  return list.length ? JSON.stringify(list) : null;
}

export const AD_DEVICES: AdDevice[] = ["mobile", "tablet", "desktop"];

/**
 * Normalise device targeting, dropping anything unrecognised.
 *
 * A typo here is not a cosmetic problem: an unrecognised device value never
 * matches, so the campaign silently stops serving everywhere. Dropping it means
 * the worst case is a campaign that serves more widely than intended.
 */
export function normalizeDeviceList(value: string | string[] | null | undefined): string | null {
  const source = Array.isArray(value) ? value.join(",") : value;
  const known = parseTargetList(source).filter((device) =>
    (AD_DEVICES as readonly string[]).includes(device)
  );
  return known.length ? JSON.stringify(known) : null;
}

/** A per-reader daily cap, or null for uncapped. */
export function normalizeFrequencyCap(value: unknown): number | null {
  const cap = Number(value);
  if (!Number.isFinite(cap) || cap <= 0) return null;
  return Math.min(100, Math.trunc(cap));
}

export interface TargetingFields {
  categories?: string | null;
  devices?: string | null;
}

export interface TargetingContext {
  categories?: string[];
  device?: AdDevice;
}

/**
 * Does this creative fit the page being viewed?
 *
 * An unset field targets everything, which is what every campaign created before
 * these fields existed already means — the widening happens here rather than in
 * a backfill, so old campaigns keep serving.
 */
export function matchesTargeting(ad: TargetingFields, ctx: TargetingContext = {}): boolean {
  const targets = parseTargetList(ad.categories);
  if (targets.length) {
    const wanted = (ctx.categories ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
    // An untagged page is not evidence that a campaign is irrelevant, so it
    // stays eligible; a page that names other categories is evidence.
    if (wanted.length && !targets.some((t) => wanted.includes(t))) return false;
  }

  const devices = parseTargetList(ad.devices);
  if (devices.length && !devices.includes(ctx.device ?? "desktop")) return false;

  return true;
}

/* ── Selection ────────────────────────────────────────────────────────────── */

/**
 * Deterministic seed in [0, 1) from the visitor, the slot and the pool size.
 *
 * FNV-1a rather than `Math.random()`, because the same reader on the same slot
 * must get the same creative for the life of their session: a pick that changes
 * on every render cannot be reconciled with the impression it recorded, and it
 * looks to the reader like the page is flickering.
 *
 * The pool size is part of the seed so that an admin publishing a new campaign
 * re-deals the cards rather than leaving the newcomer unpicked until the
 * visitor's id changes.
 */
export function stableSeed(...parts: (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const text = String(part);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    hash ^= 0x2f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0) / 0x100000000;
}

/** Weighted pick so recurring campaigns can outbid one another. */
export function pickWeighted<T extends { weight: number }>(ads: T[], seed: number): T | null {
  if (ads.length === 0) return null;
  const total = ads.reduce((sum, ad) => sum + Math.max(1, ad.weight), 0);
  let ticket = Math.min(Math.max(seed, 0), 0.999999) * total;
  for (const ad of ads) {
    ticket -= Math.max(1, ad.weight);
    if (ticket < 0) return ad;
  }
  return ads[0] ?? null;
}

export interface SelectableCreative extends TargetingFields {
  id: string;
  weight: number;
  frequencyCap?: number | null;
}

export interface SelectionContext extends TargetingContext {
  /** Stable per reader, so the rotation is theirs and not the render's. */
  visitorKey: string;
  /** Creative ids already shown on this page, so no campaign appears twice. */
  excludeIds?: string[];
  /** creative id → times shown today. Absent means uncapped. */
  seenCounts?: Record<string, number>;
  /** Pins the rotation. Tests use it; nothing else should. */
  seed?: number;
}

/** Creatives that are allowed on this page at all. */
export function eligibleCreatives<T extends SelectableCreative>(
  creatives: T[],
  ctx: SelectionContext
): T[] {
  return creatives.filter((ad) => matchesTargeting(ad, ctx));
}

/**
 * The creative this reader should see, or null so the caller can fall back.
 *
 * Both filters mean the same thing — "show them something else" — so neither is
 * relaxed when it empties the pool. Past the frequency cap the honest answer is
 * another campaign, not a fourth airing of this one; and a creative already on
 * this page is not a second placement, it is the same ad twice. Returning null
 * hands that decision to the caller, which is the only place that knows whether
 * a network fallback or an empty slot is the better answer.
 */
export function selectCreative<T extends SelectableCreative>(
  creatives: T[],
  ctx: SelectionContext
): T | null {
  const eligible = eligibleCreatives(creatives, ctx);
  if (eligible.length === 0) return null;

  const excluded = new Set(ctx.excludeIds ?? []);
  const withinCap = (ad: T): boolean => {
    if (!ctx.seenCounts) return true;
    const cap = ad.frequencyCap && ad.frequencyCap > 0 ? ad.frequencyCap : DEFAULT_FREQUENCY_CAP;
    return (ctx.seenCounts[ad.id] ?? 0) < cap;
  };

  const pool = eligible.filter((ad) => !excluded.has(ad.id) && withinCap(ad));
  const seed = ctx.seed ?? stableSeed(ctx.visitorKey, ctx.visitorKey.length, eligible.length);
  return pickWeighted(pool, seed);
}

/** Ledger key for the per-creative daily cap. */
export function capKey(slot: string, adId: string): string {
  return `${slot}:${adId}`;
}

/**
 * Reserved height from a third-party slot's declared `sizes`.
 *
 * `sizes` is a JSON array of `[width, height]` pairs, e.g. `[[300,250],[728,90]]`.
 * The first pair is the primary creative, so its height is what the page should
 * hold open — a network tag arriving into a zero-height box shifts everything
 * below it.
 */
export function reservedHeightForSizes(sizes: string | null | undefined): number | null {
  if (!sizes) return null;
  try {
    const parsed: unknown = JSON.parse(sizes);
    if (!Array.isArray(parsed)) return null;
    for (const entry of parsed) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const height = Number(entry[1]);
        if (Number.isFinite(height) && height > 0 && height < 2000) return Math.round(height);
      }
    }
    return null;
  } catch {
    return null;
  }
}
