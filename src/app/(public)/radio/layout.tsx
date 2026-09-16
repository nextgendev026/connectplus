import type { Metadata } from "next";

/**
 * Metadata for the radio desk, which is why this file exists at all.
 *
 * `page.tsx` here is a client component, and a client component cannot export
 * `metadata` — so before this file the route inherited EVERYTHING from the root
 * layout, including `alternates.canonical: "/"`. The effect was a page that the
 * sitemap advertises at priority 0.8 while its own canonical told a crawler it
 * was a duplicate of the homepage, and which served the homepage's title and
 * description to anyone who shared it. A layout is the App Router's answer for
 * exactly this case: it stays a server component, so it can carry the metadata,
 * and it renders its children unchanged.
 */
export const metadata: Metadata = {
  title: "Live Radio",
  description:
    "Listen to live East African radio on connectPlus — music, news and talk stations from Nairobi, Kampala, Dar es Salaam and Kigali, streaming in the browser with no app and no sign-up.",
  keywords: [
    "live radio Kenya",
    "Kenyan radio online",
    "East African radio streaming",
    "Nairobi radio stations",
    "Uganda radio online",
    "Tanzania radio live",
    "Rwanda radio stations",
    "listen to radio online free",
  ],
  alternates: { canonical: "/radio" },
  openGraph: {
    // Share cards are not run through the root title template, so these keep the
    // brand explicitly — same convention as the other public pages.
    title: "Live Radio · connectPlus",
    description:
      "Music, news and talk from across East Africa, streaming live in your browser.",
    type: "website",
    url: "/radio",
  },
  twitter: {
    card: "summary_large_image",
    title: "Live Radio · connectPlus",
    description: "East African radio, streaming live.",
  },
};

export default function RadioLayout({ children }: { children: React.ReactNode }) {
  return children;
}
