/**
 * Brand constants with NO runtime dependencies.
 *
 * Deliberately its own module: `settings.ts` reads Prisma and `seo.ts` imports
 * settings, so anything a client component needs (the share menu's fallback
 * card, the brand hashtag) would otherwise drag the database client into the
 * browser bundle. This file may only ever import nothing.
 */

/** What the product is called when nothing has been configured. */
export const BRAND_NAME = "connectPlus";

/**
 * The landscape social card in /public (see scripts/generate-og.mjs).
 *
 * Every share card, preview panel and Open Graph fallback starts here: a
 * 1200×630 asset that renders un-cropped, rather than the square app icon that
 * the platform metadata used to promise as landscape.
 */
export const DEFAULT_OG_IMAGE = "/og-default.png";

/** Authored dimensions of the generated card, for `openGraph.images`. */
export const OG_CARD = { width: 1200, height: 630 } as const;

/**
 * The hashtag that rides on every share. It is the whole attribution mechanism
 * on platforms that strip links, so it is never dropped from a share message.
 */
export const BRAND_HASHTAG = "connectPlus";

/** What a shared link's `utm_medium` says by default. */
export const SHARE_MEDIUM = "share";
