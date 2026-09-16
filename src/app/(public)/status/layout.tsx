import type { Metadata } from "next";

/**
 * Metadata for the status page — see the note in ../radio/layout.tsx for why this
 * has to live in a layout rather than in the page: `page.tsx` is a client
 * component, so it cannot export `metadata`, and the route was inheriting the
 * homepage's title, description and `canonical: "/"`.
 *
 * Kept indexable on purpose. An uptime page is the one place a reader checks when
 * something looks broken, and "is connectPlus down right now" is a real query;
 * a page that answers it earns the crawl.
 */
export const metadata: Metadata = {
  title: "System Status",
  description:
    "Live health of connectPlus — API, database, cache, radio streams and payment rails, refreshed continuously so you can see what is up and what is not.",
  alternates: { canonical: "/status" },
  openGraph: {
    title: "System Status · connectPlus",
    description: "Live health of the connectPlus platform, refreshed continuously.",
    type: "website",
    url: "/status",
  },
  twitter: {
    card: "summary",
    title: "System Status · connectPlus",
    description: "Live platform health.",
  },
};

export default function StatusLayout({ children }: { children: React.ReactNode }) {
  return children;
}
