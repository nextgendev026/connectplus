import type { Metadata } from "next";
import AdSlot from "@/components/ads/AdSlot";
import SportsHub from "@/components/sports/SportsHub";
import { OG_CARD, DEFAULT_OG_IMAGE } from "@/lib/brand";
import { getSiteConfig } from "@/lib/settings";
import { resolveSiteOrigin, sportsShareCard } from "@/lib/seo";
import { tipsShareSummary } from "@/lib/sports-share";

const BASE_TITLE = "Live Football Scores & Today's Predictions";
const BASE_DESCRIPTION =
  "Live football scores from the FKF Premier League, the big European leagues and the rest of the world, our model's prediction for every match and the reasons behind it — plus today's tips and a fixture calendar for the weeks ahead.";

/**
 * The site's default share card, made absolute.
 *
 * Declared explicitly rather than inherited: a page that sets `openGraph`
 * without `images` cannot rely on the root layout's image surviving the merge,
 * and a card with no image is a card most platforms render as plain text.
 */
async function siteCardImage(): Promise<{ url: string; width: number; height: number; alt: string }> {
  const origin = await resolveSiteOrigin();
  let image = DEFAULT_OG_IMAGE;
  let siteName = "connectPlus";
  try {
    const cfg = await getSiteConfig();
    image = cfg.ogImage || DEFAULT_OG_IMAGE;
    siteName = cfg.siteName;
  } catch {
    // defaults
  }
  const url = image.startsWith("http") ? image : `${origin}${image}`;
  return { url, ...OG_CARD, alt: `${siteName} — live football scores and predictions` };
}

/**
 * Metadata for the sports desk, aware of the two deep links a share can carry.
 *
 * `?tab=tips` and `?match=<fixture>` are the URLs the tips board hands out. Both
 * used to render the same static card, so a shared pick previewed as a generic
 * description of the sports page — the one thing a recipient should be able to
 * judge (the pick, and how often the model has been right) was absent. When a
 * link names a fixture, this resolves that fixture's lead pick and says so.
 *
 * A metadata read must never take the page down: every lookup here is
 * best-effort and falls back to the static card.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; match?: string }>;
}): Promise<Metadata> {
  const { tab, match } = await searchParams;

  if (tab !== "tips") {
    const image = await siteCardImage();
    return {
      title: BASE_TITLE,
      description: BASE_DESCRIPTION,
      keywords: KEYWORDS,
      alternates: { canonical: "/sports" },
      openGraph: {
        title: `${BASE_TITLE} · connectPlus`,
        description: "Every match, updating live, with our model's prediction and the reasons behind it.",
        type: "website",
        url: "/sports",
        images: [image],
      },
      twitter: {
        card: "summary_large_image",
        title: `${BASE_TITLE} · connectPlus`,
        description: "Live football scores, and predictions that explain themselves.",
        images: [image.url],
      },
    };
  }

  const card = await sportsShareCard(await tipsShareSummary(match ?? null), { matchId: match ?? null });
  const image = { url: card.image, ...OG_CARD, alt: card.title };

  return {
    title: card.title,
    description: card.description,
    keywords: KEYWORDS,
    alternates: { canonical: `/sports?tab=tips${match ? `&match=${encodeURIComponent(match)}` : ""}` },
    openGraph: {
      // Share cards are not title-templated, so the brand is explicit here.
      title: `${card.title} · connectPlus`,
      description: card.description,
      type: "website",
      url: `/sports?tab=tips${match ? `&match=${encodeURIComponent(match)}` : ""}`,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: `${card.title} · connectPlus`,
      description: card.description,
      images: [card.image],
    },
  };
}const KEYWORDS: string[] = [
  "live scores",
    "livescore today",
    "football live scores",
    "live football scores Kenya",
    "football predictions today",
    "why this prediction",
    "football betting tips",
    "over under tips",
    "both teams to score",
    "correct score predictions",
    "fixture calendar",
    "Kenyan Premier League scores",
  "African football live",
];

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
  name: "Live Football Scores & Today's Predictions",
  description:
    "Live football scores, our model's prediction for every fixture with the reasons behind it, today's tips and the fixture calendar.",
  inLanguage: "en",
  isPartOf: { "@type": "WebSite", name: "connectPlus" },
  about: { "@type": "Thing", name: "Association football results and betting markets" },
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
