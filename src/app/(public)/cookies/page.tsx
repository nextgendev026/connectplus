import type { Metadata } from "next";
import { Cookie } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";
import { PageJsonLd } from "@/components/seo/PageJsonLd";

const DESCRIPTION =
  "Every cookie and browser storage key connectPlus uses, what each one holds, how long it lasts, and how to allow, refuse or clear them — including the optional anonymous analytics and the ways you can withdraw consent.";

const UPDATED_LABEL = "14 September 2026";
const UPDATED_ISO = "2026-09-14";

export const metadata: Metadata = {
  title: "Cookies Policy",
  description: DESCRIPTION,
  keywords: [
    "connectPlus cookies policy",
    "local storage keys",
    "how to clear cookies",
    "essential cookies explained",
    "anonymous analytics consent",
    "cookie consent withdrawal",
  ],
  alternates: { canonical: "/cookies" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Cookies Policy · connectPlus",
    description: DESCRIPTION,
    type: "website",
    url: "/cookies",
  },
  twitter: {
    card: "summary",
    title: "Cookies Policy · connectPlus",
    description: DESCRIPTION,
  },
};

export default function CookiesPage() {
  return (
    <>
      <PageJsonLd
        path="/cookies"
        title="Cookies Policy"
        description={DESCRIPTION}
        updated={UPDATED_ISO}
      />
      <StaticPage
        icon={<Cookie className="w-3.5 h-3.5 text-brand-400" />}
        title="Cookies Policy"
        subtitle="A short list, written out in full. No advertising trackers, no cross-site profiling, and nothing that follows you off connectPlus."
        updatedAt={UPDATED_LABEL}
        sections={[
          {
            heading: "The short version",
            body: "connectPlus uses cookies and browser storage for four things only: keeping you signed in, remembering how you like the site to look, freezing the radio player state so a reload does not restart the stream, and — only if you allow it — counting anonymous visits. We do not sell data, we do not run advertising or cross-site tracking cookies, and no cookie we set follows you to another website.",
          },
          {
            heading: "Essential cookies",
            body: "These make the site work. They cannot be turned off while still using connectPlus, because without them signing in, posting a comment or paying for a membership is impossible. They are set by us, they are not used for advertising, and they are not shared with anyone beyond the infrastructure that delivers the page.",
            items: [
              "__Secure-next-auth.session-token (or next-auth.session-token outside production) — holds your signed-in session. HttpOnly, so page scripts cannot read it; SameSite=Lax; Secure over HTTPS. It lasts for your session window and is removed when you sign out.",
              "__Host-next-auth.csrf-token (or next-auth.csrf-token) — a one-time token that stops a different site submitting forms as you. It is regenerated regularly and discarded when you close the browser session.",
              "Sign-in flow cookies (callback-url) — remember which page you were heading to while you were authenticating, so you land there instead of the home page.",
            ],
          },
          {
            heading: "Optional analytics",
            body: "With your permission we set anonymous analytics cookies that tell us which stories, matches and stations people actually use. They record page paths and an aggregate visitor count derived from a salted, non-reversible hash — never your name, email or IP address in readable form — and they are used only to decide what to build next. Refusing them costs you nothing: every page and feature works exactly the same.",
          },
          {
            heading: "What we store in your browser",
            body: "Most of what makes connectPlus feel like your site is not a cookie at all: it is stored in your browser and never sent to us until you use the feature that needs it. These keys live under the connectplus and radio prefixes:",
            items: [
              "connectplus-theme — whether you chose the light or dark appearance, so the flash of the wrong theme stops after your first visit.",
              "connectplus-cookie-consent — your answer to the consent prompt, with the date you gave it, so we do not ask again. Delete it and the prompt returns.",
              "radio-station, radio-current-track, radio-progress — which station you were listening to, and how far into the stream you were, so returning to the radio page resumes instead of restarting.",
              "radio-favorites — the stations you starred.",
              "weather-place, weather-gps — the location you gave the weather widget, and whether it came from your device's position or from a place you typed.",
              "connectplus:dev-verify-url — a development-only helper for verifying email during local builds; it never exists on the public site.",
            ],
          },
          {
            heading: "Our infrastructure",
            body: "Pages are delivered through Cloudflare's edge network and hosted on Vercel, both of which can set a short-lived cookie for security and bot management (Cloudflare's __cf_bm is the common one). It contains no personal profile, it is not used to build an advertising identity, and it expires within minutes.",
          },
          {
            heading: "Third parties you choose to use",
            body: "When you sign in with Google, open a radio stream, or complete a payment, the provider you chose sets its own cookies under its own policy, and we do not see them. Signing in with Google is optional — a password works identically. If you would rather no third-party cookies were set at all, use a password to sign in, listen with the stream player's own controls, and pay by M-Pesa.",
          },
          {
            heading: "How to allow, refuse or clear them",
            body: "The consent card appears the first time you visit and remembers your choice. Choosing \"essential only\" leaves analytics off and keeps the site fully functional. You can change your mind at any time by clearing the connectplus-cookie-consent key (or all site data) in your browser's settings, which brings the card back so you can decide again. Every major browser can also block or delete cookies entirely, and private browsing windows discard them when closed. The one thing to know: blocking the essential session cookie means you cannot stay signed in.",
          },
          {
            heading: "Changes to this policy",
            body: "If we add a cookie or a storage key, it is described here before it ships, and the \"last updated\" date on this page changes with it. If a new cookie would need your consent, we ask for it. Our Privacy Policy at /privacy explains the wider picture — what we collect, the lawful basis for each purpose, how long we keep it, and how to exercise your rights.",
          },
        ]}
      />
    </>
  );
}
