"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useFeedCategory, type FeedCategoryValue } from "./FeedFilter";
import type { FeedCategory } from "./FeedCards";

const CATEGORY_EMOJI: Record<string, string> = {
  technology: "💻",
  culture: "🎭",
  business: "💼",
  lifestyle: "🌿",
  sports: "⚽",
  music: "🎵",
  food: "🍛",
  travel: "✈️",
};

/**
 * The category chip row.
 *
 * A client component only so the active chip can follow the URL: on a cached
 * page nothing server-side knows which category the reader arrived on. The
 * chips themselves are still real links, so the row works before hydration and
 * the URLs stay shareable.
 */
export function CategoryCarousel({
  categories,
}: {
  categories: FeedCategory[];
}) {
  const { category: categoryFilter }: FeedCategoryValue = useFeedCategory();

  return (
    <section className="border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-xl sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center gap-2 py-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory">
          <Link
            href="/"
            className={cn(
              "shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-semibold transition-all duration-200",
              !categoryFilter
                ? "bg-brand-500 text-white shadow-glow"
                : "border border-surface-700/50 text-surface-400 hover:text-surface-50 hover:border-surface-500 hover:bg-surface-800/50"
            )}
          >
            All
          </Link>
          {categories.map((cat) => {
            const emoji = CATEGORY_EMOJI[cat.slug] ?? "📄";
            const isActive = categoryFilter === cat.slug;
            return (
              <Link
                key={cat.id}
                href={`/?category=${cat.slug}`}
                className={cn(
                  "shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-xs font-medium transition-all duration-200",
                  isActive
                    ? "bg-brand-500 text-white border border-brand-400/30 shadow-glow"
                    : "border border-surface-700/50 text-surface-400 hover:text-surface-50 hover:border-surface-500 hover:bg-surface-800/50"
                )}
              >
                <span className="text-sm">{emoji}</span>
                {cat.name}{" "}
                <span
                  className={cn(
                    "ml-0.5 text-[10px]",
                    // On a brand-filled chip only a near-white accent clears AA —
                    // the pale brand step measured 1.4:1 there, and its light-mode
                    // replacement is now deep (that is its paper role).
                    isActive ? "text-white/95" : "text-surface-600"
                  )}
                >
                  {cat.count}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
