import { Suspense } from "react";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import ThemeProvider from "@/components/providers/ThemeProvider";
import { RadioPlayerProvider } from "@/components/radio/RadioPlayerContext";
import { MiniRadioPlayer } from "@/components/radio/MiniRadioPlayer";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { CookieConsent } from "@/components/pwa/CookieConsent";
import { PwaBootstrap } from "@/components/pwa/PwaBootstrap";
import RouteProgress from "@/components/layout/RouteProgress";
import { getSiteConfig, buildIntegrationScripts } from "@/lib/settings";

const DEFAULT_TITLE = "connectPlus — East African stories, live radio & real-time sports";
const DEFAULT_DESCRIPTION =
  "East Africa's home for homegrown stories, live radio, and real-time football livescores — with model-generated betting analysis and tips for every fixture. Read, write, listen, and follow the games from Nairobi to Dar es Salaam.";

/**
 * Default keyword set. It has to describe the product as it is now — a
 * publishing platform *and* a live sports desk — because these strings are what
 * a crawler reads first when the admin console has no override configured.
 */
const DEFAULT_KEYWORDS = [
  "East Africa news",
  "Kenya news",
  "Nairobi stories",
  "live football scores",
  "livescore",
  "football betting tips",
  "sports predictions",
  "Kenyan Premier League",
  "African football",
  "live radio Kenya",
  "East African radio",
  "tech blog Africa",
  "Silicon Savanna",
  "write and publish",
  "African creators",
];

/**
 * Site-wide structured data.
 *
 * `WebSite` + `SearchAction` is what lets Google attach a sitelinks search box
 * to the brand result, and `Organization` feeds the knowledge panel + logo. Both
 * are derived from live site config so a renamed site doesn't leave stale
 * markup behind advertising the old one.
 */
function buildStructuredData(params: {
  siteName: string;
  url: string;
  description: string;
  logoUrl: string;
  twitterHandle: string;
}): string {
  /**
   * A handle is operator-entered, so it can arrive as "@name", "name!", or with
   * stray whitespace. Interpolating it raw produced `https://twitter.com/name!`
   * — an invalid URL in the `sameAs` that Google rejects. Strip it down to what
   * a handle can legally contain, and drop it entirely when nothing survives
   * (better to omit `sameAs` than to publish a broken link).
   */
  const handle = params.twitterHandle.replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);
  const sameAs = handle ? [`https://twitter.com/${handle}`] : undefined;

  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${params.url}/#website`,
        url: params.url,
        name: params.siteName,
        description: params.description,
        inLanguage: "en",
        publisher: { "@id": `${params.url}/#organization` },
        potentialAction: {
          "@type": "SearchAction",
          target: {
            "@type": "EntryPoint",
            urlTemplate: `${params.url}/search?q={search_term_string}`,
          },
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "Organization",
        "@id": `${params.url}/#organization`,
        name: params.siteName,
        url: params.url,
        description: params.description,
        logo: { "@type": "ImageObject", url: params.logoUrl },
        areaServed: { "@type": "Place", name: "East Africa" },
        ...(sameAs ? { sameAs } : {}),
      },
    ],
  };
  // Escape the closing tag so a `</script>` inside config can't break out.
  return JSON.stringify(graph).replace(/</g, "\\u003c");
}

export async function generateMetadata(): Promise<Metadata> {
  let cfg;
  try {
    cfg = await getSiteConfig();
  } catch {
    cfg = null;
  }

  const siteName = cfg?.siteName ?? "connectPlus";
  const title = cfg ? `${siteName} - ${cfg.siteTagline}` : DEFAULT_TITLE;
  const description = cfg?.siteDescription ?? DEFAULT_DESCRIPTION;
  const url = cfg?.siteUrl ?? process.env.AUTH_URL ?? "https://connectplusapp.vercel.app";
  // The landscape share card, not the square icon: `openGraph.images` below
  // declares 1200×630, and a square image declared as landscape is cropped or
  // ignored by every platform that reads it.
  const ogImage = cfg?.ogImage ?? "/og-default.png";
  const ogImageUrl = ogImage.startsWith("http") ? ogImage : `${url}${ogImage}`;
  const twitterHandle = (cfg?.twitterHandle ?? "@connectplus").replace(/^@/, "");
  const keywords = cfg?.seoKeywords?.length ? cfg.seoKeywords : DEFAULT_KEYWORDS;

  // Structured metadata so crawlers and the browser chrome always pick the
  // brand-faithful vector mark first, mirroring the in-app ConnectPlusMark.
  const iconEntries = [
    { url: "/favicon.svg", type: "image/svg+xml" },
    { url: "/icon-16.png", sizes: "16x16", type: "image/png" },
    { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
    { url: "/icon-48.png", sizes: "48x48", type: "image/png" },
    { url: "/pwa-192.png", sizes: "192x192", type: "image/png" },
    { url: "/pwa-512.png", sizes: "512x512", type: "image/png" },
    { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
  ];

  return {
    metadataBase: new URL(url),
    title: {
      default: title,
      template: `%s · ${siteName}`,
    },
    description,
    keywords,
    applicationName: siteName,
    creator: siteName,
    publisher: siteName,
    category: "news",
    manifest: "/manifest.webmanifest",
    // Phone numbers and addresses are not click-to-dial targets anywhere on the
    // site, and leaving auto-detection on made iOS turn scores and prices into
    // blue phone links.
    formatDetection: { telephone: false, address: false, email: false },
    // `max-image-preview: large` is what lets a full-size thumbnail render in
    // search results instead of a cropped square — the same visual a share card
    // gets, which is the point of the whole SEO surface.
    robots:
      cfg && !cfg.robotsIndex
        ? { index: false, follow: false }
        : {
            index: true,
            follow: true,
            googleBot: {
              index: true,
              follow: true,
              "max-image-preview": "large",
              "max-snippet": -1,
              "max-video-preview": -1,
            },
          },
    alternates: {
      canonical: "/",
      types: {
        "application/rss+xml": [{ url: "/feed.xml", title: `${siteName} feed` }],
      },
    },
    icons: {
      icon: iconEntries,
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: siteName,
    },
    openGraph: {
      siteName,
      title,
      description,
      type: "website",
      url,
      // The audience is East African, and the locale is what tells a crawler
      // which regional index and which reading experience to prefer.
      locale: "en_KE",
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `${siteName} — ${cfg?.siteTagline ?? "Voices of the Silicon Savanna"}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      site: `@${twitterHandle}`,
      creator: `@${twitterHandle}`,
      images: [ogImageUrl],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    // Must match the live tokens: light is the neutral grey canvas
    // (--background #D3D3D3), dark is the deepest charcoal (--surface-950).
    // A stale value here tints the mobile browser chrome a different colour
    // from the page it frames.
    { media: "(prefers-color-scheme: light)", color: "#D3D3D3" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1114" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let cfg;
  try {
    cfg = await getSiteConfig();
  } catch {
    cfg = null;
  }
  const scripts = cfg ? buildIntegrationScripts(cfg) : "";
  const maintenance = cfg?.maintenanceMode ?? false;
  const structuredData = buildStructuredData({
    siteName: cfg?.siteName ?? "connectPlus",
    url: (cfg?.siteUrl ?? process.env.AUTH_URL ?? "https://connectplusapp.vercel.app").replace(/\/$/, ""),
    description: cfg?.siteDescription ?? DEFAULT_DESCRIPTION,
    logoUrl: `${(cfg?.siteUrl ?? process.env.AUTH_URL ?? "https://connectplusapp.vercel.app").replace(/\/$/, "")}/pwa-512.png`,
    twitterHandle: (cfg?.twitterHandle ?? "@connectplus").replace(/^@/, ""),
  });

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <script
          type="application/ld+json"
          // Site-wide schema for search engines. Server-rendered so it is in the
          // very first HTML a crawler sees, before any client hydration.
          dangerouslySetInnerHTML={{ __html: structuredData }}
        />
        {scripts ? (
          // Third-party analytics / chat / pixel snippets configured in the
          // admin Settings & Integrations console. Rendered server-side so
          // they load before first paint.
          <div dangerouslySetInnerHTML={{ __html: scripts }} />
        ) : null}
        {maintenance ? (
          <div className="relative z-[90] border-b border-brand-500/30 bg-gradient-to-r from-brand-600/20 via-accent-amber/15 to-brand-600/20 px-4 py-2 text-center text-xs font-medium text-brand-400">
            {cfg?.maintenanceMessage ?? "We're doing some maintenance — some features may be temporarily unavailable."}
          </div>
        ) : null}
        <Suspense fallback={null}>
          <RouteProgress />
        </Suspense>
        <ThemeProvider>
          {/*
            Radio transport is a server-side setting, so the player is told which
            route to prefer before it tunes anything: direct playback hands the
            listener the station's own mount (full bitrate, their own IP), and
            the proxy remains for http-only mounts and as the automatic fallback.
          */}
          <RadioPlayerProvider directEnabled={cfg?.features.radioDirect ?? true}>
            {children}
            <MiniRadioPlayer />
            {cfg?.features.pwa ? <InstallPrompt /> : null}
            <CookieConsent />
            <PwaBootstrap />
          </RadioPlayerProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}