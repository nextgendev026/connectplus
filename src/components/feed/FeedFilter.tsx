"use client";

import { createContext, Suspense, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Which category the reader is looking at.
 *
 * The feed is cached at the edge, so the page cannot read `?category=` itself —
 * touching `searchParams` on the server makes the whole route dynamic, which is
 * the cost this is here to avoid. The category is therefore resolved in the
 * browser, once, and shared with the two components that care: the chip row
 * (which one is active) and the feed (which cards are shown).
 *
 * The URL stays the single source of truth. Chips are ordinary links to
 * `/?category=…`, the categories page keeps linking there, and a bookmark or a
 * shared link still lands on the right view — the reader picks the category by
 * navigating, exactly as before, and the feed follows.
 */

export interface FeedCategoryValue {
  category: string | null;
  setCategory: (slug: string | null) => void;
}

const FeedCategoryContext = createContext<FeedCategoryValue>({
  category: null,
  setCategory: () => {},
});

/**
 * Reads the URL and renders nothing.
 *
 * `useSearchParams()` forces the client component tree up to the nearest
 * Suspense boundary to be rendered on the client, and a statically prerendered
 * page would otherwise emit that boundary's fallback in place of content. This
 * boundary's fallback is `null` and so is its content, so nothing the reader or
 * a crawler sees is affected — while the feed, which is outside it, is still
 * rendered into the HTML on the server.
 */
function CategoryFromUrl({ setCategory }: { setCategory: (slug: string | null) => void }) {
  const params = useSearchParams();
  useEffect(() => {
    const next = params.get("category");
    setCategory(next && next.trim() ? next : null);
  }, [params, setCategory]);
  return null;
}

export function FeedCategoryProvider({ children }: { children: React.ReactNode }) {
  const [category, setCategory] = useState<string | null>(null);
  // Stable identity: the reader effect depends on it, and a new function on
  // every render would re-run it (and re-render the feed) forever.
  const value = useMemo<FeedCategoryValue>(
    () => ({ category, setCategory }),
    [category]
  );

  return (
    <FeedCategoryContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <CategoryFromUrl setCategory={setCategory} />
      </Suspense>
    </FeedCategoryContext.Provider>
  );
}

export function useFeedCategory(): FeedCategoryValue {
  return useContext(FeedCategoryContext);
}
