import type { Metadata } from "next";
import AdSlot from "@/components/ads/AdSlot";
import SportsHub from "@/components/sports/SportsHub";

export const metadata: Metadata = {
  title: "Live Scores & Today's Predictions",
  description:
    "Live football and basketball scores, our model's prediction for every match and the reasons behind it — plus today's tips and a fixture calendar for the weeks ahead.",
  keywords: [
    "live scores",
    "livescore today",
    "football live scores",
    "basketball live scores",
    "football predictions today",
    "why this prediction",
    "football betting tips",
    "over under tips",
    "both teams to score",
    "correct score predictions",
    "fixture calendar",
    "Kenyan Premier League scores",
    "African football live",
  ],
  alternates: { canonical: "/sports" },
  openGraph: {
    // The brand comes from the root title template — see about/page.tsx. Share
    // cards are not templated, so these keep it explicitly.
    title: "Live Scores & Today's Predictions · connectPlus",
    description:
      "Every match, updating live, with our model's prediction and the reasons behind it.",
    type: "website",
    url: "/sports",
  },
  twitter: {
    card: "summary_large_image",
    title: "Live Scores & Today's Predictions · connectPlus",
    description: "Live scores, and predictions that explain themselves.",
  },
};

/**
 * Structured data for the sports desk.
 *
 * `CollectionPage` + `BreadcrumbList` is the honest description of this surface:
 * a hub that lists fixtures and picks. We deliberately do NOT emit `SportsEvent`
 * here — the fixtures are fetched client-side and would be stale or empty in the
 * crawler's copy, and schema that contradicts the rendered page is worse than
 * no schema at all.
 */
const SPORTS_SCHEMA = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: "Live Scores & Today's Predictions",
  description:
    "Live football and basketball scores, our model's prediction for every fixture with the reasons behind it, today's tips and the fixture calendar.",
  inLanguage: "en",
  isPartOf: { "@type": "WebSite", name: "connectPlus" },
  about: { "@type": "Thing", name: "Association football and basketball results and betting markets" },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "/" },
      { "@type": "ListItem", position: 2, name: "Sports", item: "/sports" },
    ],
  },
}).replace(/</g, "\\u003c");

/**
 * Sports hub shell. The fixture grid and the tips board are client components
 * (they poll live scores and read the model record), while the ad slots stay on
 * the server so creatives are picked and impressions counted without shipping
 * the ad pipeline to the browser.
 */
export default function SportsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: SPORTS_SCHEMA }} />
      <SportsHub
        heroAd={<AdSlot slot="sports-hero" label="Sponsored" />}
        inlineAd={<AdSlot slot="sports-inline" label="Sponsored" />}
        sidebarAd={<AdSlot slot="sports-sidebar" label="Sponsored" />}
      />
    </>
  );
}
