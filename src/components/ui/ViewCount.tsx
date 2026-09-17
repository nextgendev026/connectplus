import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatViews, viewsTitle } from "@/lib/format-views";

/**
 * The one way a view count is drawn. Ever.
 *
 * `formatViews` fixed the *number* — the same story no longer read "1,234" on a
 * blog card and "1.2K" in the feed. But the badge around it was still rebuilt by
 * hand at fourteen call sites, and the hand-built versions disagreed about the
 * things a reader actually sees: seven of them appended the noun ("1.2K views")
 * and seven did not, the eye icon was `h-3`, `h-3.5` or `h-4` depending on which
 * file you were in, and only some carried the exact figure in a tooltip. So the
 * same count still *looked* different from board to board.
 *
 * Every decision now lives here:
 *
 * - **The noun is always shown.** An eye glyph alone is a guess; "views" is not.
 *   There is deliberately no "bare number" variant: a second one is how the two
 *   spellings came back in the first place.
 * - **Two sizes, not fourteen.** `sm` is the card/list badge, `md` is for a
 *   hero or a headline stat. Anything else is a mistake, not a choice.
 * - **The exact figure is always recoverable.** `title` and `aria-label` carry
 *   "1,234 views" even when the badge shows "1.2K", so precision is one hover
 *   (or one screen reader) away, and the compact form is never the only copy.
 * - **The icon is decoration.** `aria-hidden`, because the label beside it
 *   already says the word — otherwise a screen reader announces "eye, 1.2K
 *   views" on every card in a feed.
 */
export function ViewCount({
  value,
  size = "sm",
  className,
}: {
  value: number | null | undefined;
  /** `sm` on cards and list rows, `md` in a hero or a headline stat. */
  size?: "sm" | "md";
  /** Row spacing only. Never a change of format — that is the whole point. */
  className?: string;
}) {
  const count = value ?? 0;
  const label = viewsTitle(count);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        size === "md" ? "gap-1.5" : "",
        className
      )}
      title={label}
      aria-label={label}
    >
      <Eye className={cn("shrink-0", size === "md" ? "h-4 w-4" : "h-3.5 w-3.5")} aria-hidden="true" />
      {/* One text node rather than a margin beside a second span: the gap is
          then real whitespace, so the number and the noun are never extracted as
          "1.2Kviews" by a screen reader or a scraper. */}
      <span>{`${formatViews(count)} ${count === 1 ? "view" : "views"}`}</span>
    </span>
  );
}

export default ViewCount;
