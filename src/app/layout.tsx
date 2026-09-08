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

const DEFAULT_TITLE = "connectPlus - Stories that connect East Africa";
const DEFAULT_DESCRIPTION =
  "A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa. Join the conversation.";

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
  const ogImage = cfg?.ogImage ?? "/pwa-512.png";
  const ogImageUrl = ogImage.startsWith("http") ? ogImage : `${url}${ogImage}`;
  const twitterHandle = (cfg?.twitterHandle ?? "@connectplus").replace(/^@/, "");
  const keywords = cfg?.seoKeywords?.length
    ? cfg.seoKeywords
    : [
        "blog", "East Africa", "Nairobi", "Kampala", "Dar es Salaam",
        "Kigali", "stories", "writing", "community",
      ];

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
    manifest: "/manifest.webmanifest",
    robots: cfg && !cfg.robotsIndex ? { index: false, follow: false } : undefined,
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
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: `${siteName} — ${cfg?.siteTagline ?? "Stories that connect East Africa"}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: `@${twitterHandle}`,
      images: [ogImageUrl],
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#96AEC3" },
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

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
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
          <RadioPlayerProvider>
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