import type { Metadata } from "next";
import { Layers, Radio, Rss, ShieldCheck, Users } from "lucide-react";
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
  "How connectPlus collects, uses, stores and protects your data — what we hold, the lawful basis for each purpose, every processor we use, how long we keep things, and how to exercise your rights under the Kenya Data Protection Act, 2019.";

const UPDATED_LABEL = "14 September 2026";
const UPDATED_ISO = "2026-09-14";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: DESCRIPTION,
  keywords: [
    "connectPlus privacy policy",
    "Kenya Data Protection Act 2019",
    "ODPC data subject rights",
    "how we handle your data",
    "M-Pesa payment data privacy",
    "cookie and local storage policy",
  ],
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Privacy Policy · connectPlus",
    description: DESCRIPTION,
    type: "website",
    url: "/privacy",
  },
  twitter: {
    card: "summary",
    title: "Privacy Policy · connectPlus",
    description: DESCRIPTION,
  },
};

export default async function PrivacyPage() {
  const facts = await getPlatformFacts();
  const { writers, activeMembers, activeFeeds, radioStations } = facts;

  const stats = [
    { label: "Accounts held", value: writers !== null ? formatCompact(writers) : null, icon: Users },
    { label: "Active members", value: activeMembers !== null ? formatCompact(activeMembers) : null, icon: Layers },
    { label: "Publisher feeds", value: activeFeeds, icon: Rss },
    { label: "Radio stations", value: radioStations, icon: Radio },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: String(s.value), icon: s.icon }));

  const faq = [
    {
      question: "Who is responsible for my data?",
      answer:
        "connectPlus is the data controller for the personal data described on this page — we decide why it is collected and how it is used. Privacy requests go to privacy@connectplus.io and are answered within 30 days as the Kenya Data Protection Act, 2019 requires.",
    },
    {
      question: "Do you sell my data or run advertising trackers?",
      answer:
        "No. We do not sell data, we do not run advertising or cross-site tracking cookies, and no cookie we set follows you to another website. Our processors act only on our instructions and none of them receives your payment credentials.",
    },
    {
      question: "How do I get a copy of my data or delete my account?",
      answer:
        "Under the Kenya Data Protection Act, 2019 you may ask for a copy of your data, have it corrected, erased, ported, or withdraw consent. Most of this is available from your profile settings; anything else goes to privacy@connectplus.io. Deleting your account does not cancel a subscription, so cancel it first.",
    },
    {
      question: "Do you train AI models on my drafts?",
      answer:
        "No. Drafts stay private and are only processed when you invoke an assistant on them. We do not use your private drafts to train third-party models, and we ask our provider the same thing contractually.",
    },
  ];

  return (
    <>
      <PageJsonLd
        path="/privacy"
        title="Privacy Policy"
        description={DESCRIPTION}
        updated={UPDATED_ISO}
      />
      <FaqJsonLd path="/privacy" questions={faq} />
      <StaticPage
        icon={<ShieldCheck className="w-3.5 h-3.5 text-brand-400" />}
        title="Privacy Policy"
        subtitle="Your data belongs to you. Here's exactly what we collect, why we need it, who touches it, and how to take it back."
        stats={<StatGrid stats={stats} columns={4} />}
        faq={faq}
        updatedAt={UPDATED_LABEL}
        sections={[
          {
            heading: "Who is responsible for your data",
            body: "connectPlus is the data controller for the personal data described in this policy — we decide why it is collected and how it is used. We are established in Kenya. Privacy requests, questions and objections go to privacy@connectplus.io, and we answer within 30 days as the Data Protection Act, 2019 requires. Our support address (support@connectplus.io) handles account and billing questions that are not about data.",
          },
          {
            heading: "What we collect",
            body: "We collect the minimum needed to run a publishing and live-sports platform, and nothing more.",
            items: [
              "Account details — email address, display name, username, password hash or Google identifier, avatar, bio, and any profile links you add.",
              "Content you publish — stories, drafts, comments, likes, bookmarks, follows, and the images you upload.",
              "Reader activity — which stories you open, what you search for, and the picks, matches and radio stations you follow. This is what makes your feed and your alerts relevant instead of generic.",
              "Technical data — IP address, approximate location derived from it (usually city level), browser and device details, and the timestamps of your requests. We keep this short-lived, primarily to stop abuse and to keep the service up.",
              "Payment records — the provider reference, amount, currency, plan and outcome of a payment, plus the phone number you gave M-Pesa. Never a card number, never an M-Pesa PIN, never a PayPal password.",
              "Correspondence — messages you send us, including reports, appeals and support email.",
            ],
          },
          {
            heading: "Why we process it, and on what basis",
            body: "Every purpose below rests on a lawful basis under the Kenya Data Protection Act, 2019 (and, for visitors in Europe, the equivalent basis under the GDPR).",
            items: [
              "To create and secure your account, and to publish what you write — necessary to perform our contract with you.",
              "To take and reconcile payments, and to keep the accounting records that prove your membership — contract, and our legal obligation to keep financial records.",
              "To deliver your feed, alerts, livescores and radio metadata — contract, and our legitimate interest in running a service that works.",
              "To detect abuse, spam, scraping and fraud, and to keep the platform available — legitimate interest. We weigh this against your rights, and it never extends to profiling you for advertising.",
              "To send you service email (verification, receipts, security notices) — contract. Marketing email is only ever sent with your consent, and every marketing message carries a one-click unsubscribe.",
              "To answer your enquiry to privacy@connectplus.io — legitimate interest, or consent where the enquiry is sensitive.",
            ],
          },
          {
            heading: "Signing in with Google",
            body: "If you choose \"Continue with Google\", Google tells us your email address, name and profile picture so we can create or match your account. If you already registered with a password, the two are linked to the same account rather than duplicated. We receive no access to your Google password, your Gmail or any other Google service. You can remove the link and set a password instead at any time from your settings.",
          },
          {
            heading: "Payments and billing",
            body: "We do not process payments ourselves, and we never see the instrument you pay with. Two providers do, and they are the only parties that ever handle it: Safaricom (for M-Pesa) and PayPal (for cards and PayPal balances). Both are independent controllers for the information they collect while taking a payment, and their own privacy policies apply to it. To take a subscription we ask for a phone number when you pay by M-Pesa, and we store it alongside the payment so receipts, renewals and support requests can be reconciled. We store the provider's reference for each payment (an M-Pesa receipt number or a PayPal capture id), the amount, the currency, the plan bought and the outcome, because that record is what proves your membership and what we are required to keep for accounting. We never store your M-Pesa PIN, your card number or your PayPal password.",
          },
          {
            heading: "Cookies and local storage",
            body: "We use a small number of cookies and browser storage keys: a session cookie that keeps you signed in, a theme preference, a consent record so we stop asking, and locally stored drafts so writing is never lost to a closed tab. We do not run third-party advertising or cross-site tracking cookies. The Cookies Policy at /cookies lists every one of them, what it holds and how long it lasts, and how to clear them.",
          },
          {
            heading: "Sports, radio and live data",
            body: "When you follow a team, open a match or listen to a station, we record the fixture or station identifier so the board and the mini player can resume where you left off. Livescore data is fetched from public sports feeds and cached at the edge; the feed request carries no information about you. If you enable match alerts, we store that preference against your account until you turn it off or delete the account.",
          },
          {
            heading: "AI features and your content",
            body: "Some features summarise, tag, rank or check content using language models: story drafting assistance, automatic tagging, moderation pre-screening, semantic search, and the model probabilities published on the sports desk. Published stories and public comments may be sent to our model provider for those tasks. Drafts stay private and are only processed when you invoke an assistant on them. We do not use your private drafts to train third-party models, and we ask our provider the same thing contractually. Automated moderation never makes the final decision on a report — a human reviews the outcome.",
          },
          {
            heading: "Who else touches your data",
            body: "We use a deliberately short list of processors, each contracted to act only on our instructions. None of them receives your payment credentials.",
            items: [
              "Vercel — application hosting and serverless compute.",
              "Cloudflare — CDN, edge cache, media delivery and the workers that serve livescores.",
              "Supabase — managed PostgreSQL database and object storage.",
              "Resend — transactional email delivery.",
              "Inngest — the scheduler that runs publishing, RSS and sports jobs.",
              "Safaricom (M-Pesa) and PayPal — payment processing and settlement.",
              "Our AI provider — text generation, tagging, embeddings and moderation pre-screening.",
            ],
          },
          {
            heading: "Where your data goes",
            body: "Our servers and database run in data centres inside the European Union and the United States, so your data may be transferred outside Kenya. Where that happens we rely on the transfer safeguards the Data Protection Act recognises for cross-border transfers — a processor contract that imposes data-protection obligations at least equivalent to Kenya's, and, where a provider offers them, standard contractual clauses. The lawful basis for the transfer is the performance of our contract with you together with our legitimate interest in operating a reliable service. Ask privacy@connectplus.io if you want the detail of a specific provider.",
          },
          {
            heading: "How long we keep it",
            body: "Account data lives while the account exists, and is deleted when you delete the account. Content you published publicly may remain in caches and in search-engine indexes for a short time after deletion — that is a property of the web, and we honour removal requests for the underlying record immediately. Payment records and their references are kept after cancellation for as long as tax and accounting rules require. Detailed abuse and request logs roll off within 30 days. Analytics that rely on a visitor cookie use a salted, non-reversible hash rather than an IP address, so unique visits can be counted without identifying anyone.",
          },
          {
            heading: "How we protect it",
            body: "Traffic is encrypted in transit with TLS, and the hosted database enforces encryption at rest. Passwords are stored only as salted hashes, and never in a form we can read. Sessions are signed cookies that anyone without the signing key cannot forge. Administrative access is limited to a handful of accounts, requires authentication, and is logged. Webhooks from our payment providers are verified with a shared secret rather than trusted on sight. If a breach creates a real risk to you, we will notify you and the Office of the Data Protection Commissioner as the Act requires, and we will tell you what we know rather than waiting for the full forensic picture.",
          },
          {
            heading: "Your rights",
            body: "Under the Kenya Data Protection Act, 2019 you may ask for a copy of your data, have it corrected, have it erased, object to or restrict certain processing, ask us to port it to another service, and withdraw consent you previously gave. You can exercise most of these from your profile settings; anything else goes to privacy@connectplus.io and we respond within 30 days. If you believe we have got it wrong and we have not resolved it, you can complain to the Office of the Data Protection Commissioner. Deleting your account does not cancel a subscription, so cancel it first — otherwise the provider may keep billing an account that no longer exists.",
          },
          {
            heading: "Children and betting content",
            body: "connectPlus is not directed at children. You must be 18 or older, or the age of majority where you live, to hold an account, and we do not knowingly collect data from anyone younger. The sports desk publishes model probabilities and betting analysis for adults; that material is not intended for minors. If you believe a child has created an account, contact privacy@connectplus.io and we will close it and delete the data.",
          },
          {
            heading: "Changes to this policy",
            body: "When our practices change we update this page and its \"last updated\" date, and we state what changed in plain language rather than quietly reissuing the text. Material changes that affect your rights are announced in the app and, for account holders, by email before they take effect. Continuing to use connectPlus after an update means you accept the revised policy; if you do not, you can delete your account at any time.",
          },
        ]}
      />
    </>
  );
}
