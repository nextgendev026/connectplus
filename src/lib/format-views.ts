/**
 * The one place a view count becomes text.
 *
 * There were four competing answers to this before: `post.viewCount.toLocaleString()`
 * on the blog card, profile card and hero slideshow; and three separate copies of
 * a `1.2K` compactor in the feed, the trending rail and the load-more list. So the
 * same story read "1,234 views" on the blog and "1.2K" on the feed, and a reader
 * scrolling from one to the other saw the number appear to change.
 *
 * Compact is the format that can be used *everywhere* — a badge is a few
 * characters wide and `1,234,567` does not fit in one. The exact figure is not
 * lost: every caller puts it in the element's `title`, which is where a reader
 * who wants precision goes looking for it.
 */

/** 1.0K reads wrong; 1K does not. Trim the meaningless decimal. */
function trim(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed;
}

function normalise(count: number): number {
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

/**
 * `1234` → `1.2K`, `1_200_000` → `1.2M`, `42` → `42`.
 *
 * The million branch takes over at 999_500 rather than 1_000_000, because
 * "1000K" is not a number anybody writes.
 */
export function formatViews(count: number): string {
  const n = normalise(count);
  if (n < 1000) return String(n);
  if (n < 999_500) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

/**
 * The same compactor, for any other engagement counter.
 *
 * Likes, comments and story counts were compacted by copy-pasted helpers too,
 * and a rail showing `1.2K` next to a badge showing `1,234` is the same
 * inconsistency in a different column.
 */
export const formatCompact = formatViews;

/** The exact figure, for a tooltip or a detail header that has room for it. */
export function formatExactViews(count: number): string {
  return normalise(count).toLocaleString();
}

/**
 * `title` text for a view badge — "1,234 views (1.2K shown)".
 *
 * Only when the two differ: telling a reader that 42 is also "42" is noise.
 */
export function viewsTitle(count: number): string {
  const exact = formatExactViews(count);
  const compact = formatViews(count);
  const noun = normalise(count) === 1 ? "view" : "views";
  return compact === exact ? `${exact} ${noun}` : `${exact} ${noun} (${compact} shown)`;
}
