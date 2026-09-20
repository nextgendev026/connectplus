import type { Metadata } from "next";
import { BookOpen, Handshake, MessageCircle, Rss, Users } from "lucide-react";
import Link from "next/link";
import { StaticPage } from "@/components/ui/StaticPage";
import { StatGrid } from "@/components/ui/StatGrid";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { FaqJsonLd } from "@/components/seo/FaqJsonLd";
import { getPlatformFacts } from "@/lib/platform-facts";
import { formatCompact } from "@/lib/format-views";
import { BRAND_SUPPORT_EMAIL } from "@/lib/brand";

// Live platform facts, but no per-request state: no cookies, no session, no
// query params. Marked `force-dynamic`, this ran a full server render and its
// database queries for every visit and every crawl of a page whose numbers move
// over hours. ISR serves the same content from the CDN and revalidates behind
// the request, so the cost lands on a schedule instead of on each reader.
export const revalidate = 300;

const DESCRIPTION =
  "Get in touch with the connectPlus team — support and feedback, press, partnerships and syndication enquiries from publishers across East Africa, all answered within one business day.";

export const metadata: Metadata = {
  title: "Contact",
  description: DESCRIPTION,
  keywords: [
    "contact connectPlus",
    "connectPlus support",
    "publisher syndication Kenya",
    "media partnership East Africa",
    "press contact Nairobi tech",
  ],
  alternates: { canonical: "/contact" },
  robots: { index: true, follow: true },
  openGraph: { title: "Contact · connectPlus", description: DESCRIPTION, type: "website", url: "/contact" },
  twitter: { card: "summary", title: "Contact · connectPlus", description: DESCRIPTION },
};

export default async function ContactPage() {
  const facts = await getPlatformFacts();
  const { writers, publishedStories, categories, activeFeeds } = facts;

  const stats = [
    { label: "Community", value: writers !== null ? formatCompact(writers) : null, icon: Users },
    { label: "Stories live", value: publishedStories !== null ? formatCompact(publishedStories) : null, icon: BookOpen },
    { label: "Categories", value: categories, icon: MessageCircle },
    { label: "Publisher feeds", value: activeFeeds, icon: Rss },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: String(s.value), icon: s.icon }));

  const faq = [
    {
      question: "How do I report a bug or get account help?",
      answer: `Email ${BRAND_SUPPORT_EMAIL} with what you were doing, what you expected, and any error message you saw. Our team responds to support requests within one business day.`,
    },
    {
      question: "How quickly will I get a reply?",
      answer:
        "Support and feedback are answered within one business day. Press, partnership and legal enquiries are routed to the right person and answered within two business days.",
    },
    {
      question: "How do I propose a partnership or press enquiry?",
      answer:
        "Journalists, institutions and brands can reach the partnerships team through the contacts on this page. We partner with media houses, universities, and community organisations across East Africa.",
    },
    {
      question: "I am a publisher — how do I ask for a takedown?",
      answer: `If a syndicated item should be removed, or the terms of your feed have changed, email a link to the item to ${BRAND_SUPPORT_EMAIL} and we will take it down promptly. No formal process is needed.`,
    },
  ];

  return (
    <div>
      <PageJsonLd path="/contact" title="Contact us" description={DESCRIPTION} />
      <FaqJsonLd path="/contact" questions={faq} />
      <StaticPage
        icon={<MessageCircle className="w-3.5 h-3.5 text-brand-400" />}
        title="Contact us"
        subtitle="We read everything. Whether it's a bug, a feature idea, a partnership, or just a hello — reach out."
        stats={<StatGrid stats={stats} columns={4} />}
        faq={faq}
        updatedAt="14 September 2026"
        sections={[
          {
            heading: "Support & feedback",
            body: `Having trouble with your account, writing studio, or payments? Our team responds to support requests within one business day. Reach us at ${BRAND_SUPPORT_EMAIL} with the details, and include any errors you're seeing.`,
          },
          {
            heading: "Press & partnerships",
            body: "Journalists, institutions, and brands interested in working with connectPlus can reach the team through the partnerships address below. We partner with media houses, universities, and community organizations across East Africa.",
            items: [
              "Partnerships & press — partners@connectplus.io",
              "Billing, refunds and receipts — billing@connectplus.io",
              "Legal, copyright and takedown — legal@connectplus.io",
            ],
          },
        ]}
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-20 -mt-2">
        <div className="rounded-3xl border border-surface-800/60 bg-gradient-to-br from-brand-500/8 to-accent-cyan/5 p-8 sm:p-10 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-500/10 border border-brand-500/20">
            <Handshake className="h-5 w-5 text-brand-400" />
          </div>
          <h2 className="font-display text-2xl font-bold text-surface-50 mb-3">
            Prefer to start writing?
          </h2>
          <p className="text-surface-400 text-sm leading-relaxed max-w-xl mx-auto mb-6">
            The fastest way to get our attention is to share a story. Join the
            community and publish today.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600 transition-all shadow-glow hover:scale-[1.02]"
            >
              Create your account
            </Link>
            <Link
              href="/studio"
              className="inline-flex items-center justify-center rounded-xl border border-surface-700 px-6 py-3 text-sm font-medium text-surface-300 hover:bg-surface-800/50 transition-colors"
            >
              Open the studio
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
