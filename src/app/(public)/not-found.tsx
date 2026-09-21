import Link from "next/link";
import { Compass, Search } from "lucide-react";

/**
 * The public 404.
 *
 * Without a `not-found.tsx` in this route group, a real `notFound()` rendered
 * Next's unstyled default — which is why the tag page answered a missing topic
 * with a friendly page and a **200**. A 200 for a page that does not exist is a
 * soft 404: it tells a crawler the URL is a real, indexable page, so the tag
 * route's own "topic not found" screen was the one thing on it worth not
 * indexing, and stating it as a success was the wrong answer either way.
 *
 * Answering with a genuine 404 and a page that still looks like the app gets
 * both: the crawler is told the truth, and a reader who mistyped or followed a
 * stale link gets their way back into the archive rather than a dead end.
 */
export default function PublicNotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-surface-950 px-4 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-surface-700/50 bg-surface-900">
        <Compass className="h-7 w-7 text-surface-500" />
      </div>
      <h1 className="mt-6 font-display text-3xl font-bold text-surface-50 sm:text-4xl">
        This page has moved on
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-surface-400">
        The link may be wrong, or the story may have been withdrawn. Either way,
        there is plenty to read — the front page always has the latest.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
        >
          Read the latest stories
        </Link>
        <Link
          href="/search"
          className="inline-flex items-center gap-2 rounded-xl border border-surface-700 px-6 py-3 text-sm font-medium text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100"
        >
          <Search className="h-4 w-4" />
          Search connectPlus
        </Link>
      </div>
    </div>
  );
}
