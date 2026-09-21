"use client";

import { useEffect, useRef, useState } from "react";
import { ViewCount } from "@/components/ui/ViewCount";

/**
 * The article's view badge, and the thing that actually counts the view.
 *
 * The page it sits on is cached at the edge, so it renders the best total it
 * knows — the nightly-folded `Post.viewCount` — and this component reports the
 * read once, from the browser. That split is what lets the page be served from
 * the CDN at all, and it fixes the count as a side effect: a server-render
 * write counted crawlers, prefetches and bfcache restores, none of which is a
 * reader.
 *
 * The badge never goes backwards. A response can carry a lower number than the
 * one on screen (a Convex row folded into Postgres and reset, a partial answer)
 * and showing a story as *less* read than it was a second ago is always wrong,
 * so the update is a maximum.
 */
export function ArticleViews({
  postId,
  initialValue,
}: {
  postId: string;
  /** The total the page was rendered with: stored count, or live if known. */
  initialValue: number;
}) {
  const [value, setValue] = useState(initialValue);
  const reported = useRef(false);

  useEffect(() => {
    // One report per mount. React's dev-mode double-invoke is guarded by the
    // ref, which survives it, and a re-render never re-reports.
    if (reported.current) return;
    reported.current = true;

    fetch("/api/views", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postId }),
      // Let the request finish even if the reader taps straight through to
      // another story — a navigation unloads the page.
      keepalive: true,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const live = data?.viewCount;
        if (typeof live === "number" && Number.isFinite(live)) {
          setValue((current) => Math.max(current, live));
        }
      })
      .catch(() => {
        // The stored total stays on screen; a miss is not worth a retry.
      });
  }, [postId]);

  return <ViewCount value={value} />;
}
