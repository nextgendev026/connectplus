import type { Metadata } from "next";
import { BookOpen, Layers, ScrollText, Users } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";
import { StatGrid } from "@/components/ui/StatGrid";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { FaqJsonLd } from "@/components/seo/FaqJsonLd";
import { getPlatformFacts } from "@/lib/platform-facts";
import { formatCompact } from "@/lib/format-views";

// Live platform facts, but no per-request state: no cookies, no session, no
// query params. Marked `force-dynamic`, this ran a full server render and its
// database queries for every visit and every crawl of a page whose numbers move
// over hours. ISR serves the same content from the CDN and revalidates behind
// the request, so the cost lands on a schedule instead of on each reader.
export const revalidate = 300;

const DESCRIPTION =
  "The terms that govern your connectPlus account: what you may publish, how M-Pesa and PayPal memberships bill and renew, how cancellation and refunds work, moderation, AI features, and the law that applies to our agreement.";

const UPDATED_LABEL = "14 September 2026";
const UPDATED_ISO = "2026-09-14";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: DESCRIPTION,
  keywords: [
    "connectPlus terms of service",
    "membership terms Kenya",
    "M-Pesa subscription terms",
    "PayPal subscription terms",
    "content licence publishing terms",
    "cancellation and refund policy",
  ],
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Terms of Service · connectPlus",
    description: DESCRIPTION,
    type: "website",
    url: "/terms",
  },
  twitter: {
    card: "summary",
    title: "Terms of Service · connectPlus",
    description: DESCRIPTION,
  },
};

export default async function TermsPage() {
  const facts = await getPlatformFacts();
  const { publishedStories, activeMembers, plans, syndicatedStories } = facts;

  const stats = [
    { label: "Stories published", value: publishedStories !== null ? formatCompact(publishedStories) : null, icon: BookOpen },
    { label: "Active members", value: activeMembers !== null ? formatCompact(activeMembers) : null, icon: Users },
    { label: "Plan tiers", value: plans, icon: Layers },
    { label: "Syndicated stories", value: syndicatedStories !== null ? formatCompact(syndicatedStories) : null, icon: ScrollText },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: String(s.value), icon: s.icon }));

  const faq = [
    {
      question: "Who owns the stories I publish?",
      answer:
        "You retain ownership of the stories you write and the images you upload. By publishing you grant connectPlus a worldwide, non-exclusive, royalty-free licence to host, display and distribute that content so readers can reach it. The licence ends when you delete the content.",
    },
    {
      question: "Do M-Pesa memberships auto-renew?",
      answer:
        "No. M-Pesa memberships are bought one period at a time and do not auto-renew — nothing is deducted from your wallet again unless you deliberately buy another period. PayPal memberships renew automatically until you cancel.",
    },
    {
      question: "Can I get a refund?",
      answer:
        "Cancelling does not refund the current period, but if a charge was taken in error, you were billed twice, or the service was unavailable for a sustained period, contact billing@connectplus.io within 30 days and we will make it right, including a full refund where that is fair.",
    },
    {
      question: "What happens if a payment fails?",
      answer:
        "Your plan is not activated, or a renewal lapses, and you move to the free experience. You will not be charged a penalty, we do not charge reactivation fees, and we do not delete your account because a payment failed.",
    },
    {
      question: "Is the sports betting content advice?",
      answer:
        "No. The sports desk publishes probabilistic model output for information and entertainment. It is not financial advice, no prediction is a certainty, and we take no stake in any bet you place with a third party. We do not accept wagers.",
    },
  ];

  return (
    <>
      <PageJsonLd
        path="/terms"
        title="Terms of Service"
        description={DESCRIPTION}
        updated={UPDATED_ISO}
      />
      <FaqJsonLd path="/terms" questions={faq} />
      <StaticPage
        icon={<ScrollText className="w-3.5 h-3.5 text-brand-400" />}
        title="Terms of Service"
        subtitle="The rules that keep connectPlus fair for readers, writers and the publishers we syndicate — in plain language, with no surprises buried halfway down."
        stats={<StatGrid stats={stats} columns={4} />}
        faq={faq}
        updatedAt={UPDATED_LABEL}
        sections={[
          {
            heading: "This agreement",
            body: "These terms are a binding agreement between you and connectPlus. By creating an account, publishing a story, subscribing to a membership or simply reading, you accept them. If you do not accept them, do not use the service. Where these terms refer to \"we\" or \"us\", they mean connectPlus; \"you\" means the person holding the account, and if you are using connectPlus for an organisation, the organisation too.",
          },
          {
            heading: "Eligibility and your account",
            body: "You must be 18 or older — or the age of majority where you live, whichever is higher — to hold an account, because the sports desk publishes betting analysis for adults. You are responsible for safeguarding your credentials and for everything published under your account, including anything posted by someone using a device you left signed in. Keep your email verified so we can reach you about security and billing, and report suspicious activity to support@connectplus.io immediately. You may sign in with a password or with Google; either way the account and its contents are your responsibility. One person, one account: throwaway accounts created to evade a suspension are removed.",
          },
          {
            heading: "Content you publish",
            body: "You retain ownership of the stories you write and the images you upload. By publishing on connectPlus you grant us a worldwide, non-exclusive, royalty-free licence to host, store, reproduce, display and distribute that content so readers can reach it — through the site, our RSS feed, our apps and the preview cards that social platforms render when a link is shared. The licence lasts as long as the content is published and ends when you delete it, except for copies already cached or already delivered to a subscriber's inbox. You must have the right to publish everything you share: text, images, and any quotation from another work. You are the author of record for it, and you are responsible for it.",
          },
          {
            heading: "Syndicated and third-party content",
            body: "Some stories in the feed come from other publishers' public feeds. We republish syndicated items only where the source permits it, we credit the publisher on the article page with a link back to the original, and we never present syndicated work as our own reporting. If you are a publisher and you want an item removed, or the terms of your feed have changed, email a link to the item to support@connectplus.io and we will take it down promptly — no formal process needed. Syndication does not transfer ownership: copyright in those stories stays with the publisher.",
          },
          {
            heading: "Acceptable use",
            body: "connectPlus exists so people can read, write, listen and follow the games. Keep it that way. The following are prohibited, and we may remove content and suspend accounts that breach them:",
            items: [
              "Publishing content you do not own, or stripping another publisher's attribution from syndicated material.",
              "Spam, bulk commercial messaging, referral schemes, pyramid promotions and engagement farming.",
              "Malware, phishing, deceptive links, credential harvesting, or anything designed to compromise a reader's device or account.",
              "Hate speech, incitement, harassment, threats, defamation, and targeted abuse of another person.",
              "Sexual content involving minors, non-consensual intimate imagery, or any content that is unlawful in Kenya.",
              "Impersonating another person, a brand, or a member of our team.",
              "Scraping the service at scale, bypassing rate limits, probing for vulnerabilities, or reselling access without a written agreement.",
              "Using the platform to run an unlicensed betting operation, or to market one.",
            ],
          },
          {
            heading: "Memberships and billing",
            body: "Paid plans are billed in advance for the period you choose — monthly or yearly. M-Pesa payments are settled in Kenyan shillings at the rate shown at checkout; PayPal payments are settled in US dollars and converted by PayPal for your card. We charge the price displayed on the pricing page at the moment you pay, and we always show you the amount before you approve it. Your plan is activated as soon as the provider confirms the payment. A payment you abandon on your handset never charges you, and an expired or cancelled prompt has no cost.",
          },
          {
            heading: "Renewals, cancellation and refunds",
            body: "M-Pesa memberships are bought one period at a time and do not auto-renew: nothing is deducted from your M-Pesa wallet again unless you deliberately buy another period. PayPal memberships renew automatically through PayPal until you cancel. You can cancel at any time from your settings, which stops the next charge; you keep access until the end of the period you already paid for. Cancelling does not refund the current period. If a charge was taken in error, if you were billed twice, or if the service was unavailable for a sustained period, contact billing@connectplus.io within 30 days and we will make it right, including a full refund where that is the fair outcome. Refunds are returned through the same rail the payment came from.",
          },
          {
            heading: "Failed payments",
            body: "If a payment cannot be completed — insufficient M-Pesa balance, a declined card, or a lapsed PayPal mandate — your plan is not activated, or a renewal lapses, and you move to the free experience. You will not be charged a penalty, and you can pay again at any time from the pricing page. We do not charge reactivation fees and we do not delete your account because a payment failed.",
          },
          {
            heading: "Moderation, reports and appeals",
            body: "We moderate content to keep the community safe. Content that violates these terms may be removed, and repeat offenders may lose access; serious cases — child safety, credible threats, coordinated fraud — result in immediate suspension. Our AI supports human moderators by pre-screening reports and flagging likely violations; it never makes the final decision alone. If your content was removed and you believe that was wrong, reply to the notice or email support@connectplus.io and a human will review the decision.",
          },
          {
            heading: "AI features",
            body: "Drafting assistance, automatic tagging, moderation pre-screening, semantic search and the published match probabilities are produced with language models. Output can be wrong, incomplete or out of date, and it is your responsibility to check anything you publish with its help. Never paste secrets, other people's private data, or confidential material into an assistant. Model output is not a promise about the future: a 62% probability means 62%, not certainty.",
          },
          {
            heading: "Betting information, not advice",
            body: "The sports desk publishes probabilistic model output for information and entertainment. It is not financial advice, no prediction is a certainty, and we take no stake in any bet you place with a third party. We do not accept wagers, we do not handle stakes, and we are not a licensed bookmaker. Most markets we write about are 18+. If gambling stops being a game for you, stop — and reach out to a support service in your country.",
          },
          {
            heading: "Third-party links and services",
            body: "connectPlus links to other sites and embeds third-party players, feeds and payment pages. We do not control them and we are not responsible for their content, availability or privacy practices — their terms apply once you follow a link. Radio streams, fixture data and news feeds come from third parties, and may change, break or disappear without notice.",
          },
          {
            heading: "Availability and changes to the service",
            body: "We work to keep connectPlus available, and we publish a live status page rather than pretending there are never incidents. We may add, change or retire features, and we may suspend the service briefly for maintenance. If we discontinue a paid feature you are paying for, we will give you notice and pro-rata credit or a refund for the unused period. We may also update these terms; material changes are announced in the app and by email before they take effect, and continuing to use connectPlus means you accept them.",
          },
          {
            heading: "Liability",
            body: "connectPlus is provided as-is. To the fullest extent permitted by law, we are not liable for indirect or consequential damages, lost profits, lost data you did not back up, or the conduct of other users — arising from your use of the platform. Our total liability is limited to the fees you have paid us in the twelve months before the claim. Nothing in these terms limits liability that cannot lawfully be limited. If you are a consumer, you keep every statutory right you have.",
          },
          {
            heading: "Governing law and disputes",
            body: "These terms are governed by the laws of Kenya, and the courts of Kenya have jurisdiction over any dispute — without removing any right you have to bring a claim in the courts of your own country of residence as a consumer. Before either of us starts proceedings, write to legal@connectplus.io with the facts and what you want; most disagreements are a misunderstanding and a refund away from being resolved in a day.",
          },
          {
            heading: "Contact",
            body: "Support and moderation appeals: support@connectplus.io. Billing, refunds and receipts: billing@connectplus.io. Legal notices, copyright and takedown requests: legal@connectplus.io. We aim to answer every message within two business days.",
          },
        ]}
      />
    </>
  );
}
