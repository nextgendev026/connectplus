/**
 * Lightweight A/B testing framework (Phase 3).
 *
 * Variants are assigned deterministically from a stable hash of the user id and
 * experiment name, so a user always sees the same variant and results can be
 * compared per variant in the admin pipeline dashboard. Anonymous users are not
 * assigned a variant (they fall back to the control behaviour without logging).
 */

export const FEED_RANK_EXPERIMENT = "feed-rank";

export type FeedRankVariant = "control" | "personalized-light" | "personalized-full";

export const FEED_RANK_VARIANTS: FeedRankVariant[] = [
  "control",
  "personalized-light",
  "personalized-full",
];

/** Deterministic 32-bit string hash (FNV-1a). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Returns the variant a user belongs to for an experiment. Falls back to the
 * first variant (control) for missing ids.
 */
export function getExperimentVariant<T extends string>(
  userId: string | null | undefined,
  experiment: string,
  variants: readonly T[]
): T {
  if (!userId || variants.length === 0) return variants[0] as T;
  const h = hash32(`${experiment}:${userId}`);
  return variants[h % variants.length] as T;
}

/** The active feed-ranking variant for a signed-in user (or control). */
export function getFeedRankVariant(userId: string | null | undefined): FeedRankVariant {
  return getExperimentVariant(userId, FEED_RANK_EXPERIMENT, FEED_RANK_VARIANTS);
}