import type { Metadata } from "next";
import { BadgeDollarSign, HandCoins, Layers, TrendingUp, Users, Wallet } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";
import { StatGrid } from "@/components/ui/StatGrid";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { FaqJsonLd } from "@/components/seo/FaqJsonLd";
import { getPlatformFacts } from "@/lib/platform-facts";
import { formatCompact } from "@/lib/format-views";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Turn your writing into income on connectPlus — earn from reader engagement, see how the numbers are calculated, and get paid through M-Pesa or PayPal once you reach the eligibility threshold.";

export const metadata: Metadata = {
  title: "Monetize",
  description: DESCRIPTION,
  keywords: [
    "get paid to write Kenya",
    "writer monetisation East Africa",
    "connectPlus payouts",
    "M-Pesa writer payouts",
    "earn from blogging Kenya",
  ],
  alternates: { canonical: "/monetize" },
  robots: { index: true, follow: true },
  openGraph: { title: "Monetize · connectPlus", description: DESCRIPTION, type: "website", url: "/monetize" },
  twitter: { card: "summary", title: "Monetize · connectPlus", description: DESCRIPTION },
};

function kes(amount: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function MonetizePage() {
  const facts = await getPlatformFacts();
  const { payoutsAmount, creatorsPaid, tipsSettled, activeMembers, plans } = facts;

  const stats = [
    { label: "Paid to writers", value: payoutsAmount !== null ? kes(payoutsAmount) : null, icon: HandCoins },
    { label: "Creators paid", value: creatorsPaid !== null ? formatCompact(creatorsPaid) : null, icon: Users },
    { label: "Tips settled", value: tipsSettled !== null ? formatCompact(tipsSettled) : null, icon: BadgeDollarSign },
    { label: "Active members", value: activeMembers !== null ? formatCompact(activeMembers) : null, icon: TrendingUp },
    { label: "Plan tiers", value: plans, icon: Layers },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: String(s.value), icon: s.icon }));

  // Written only from what the platform can actually demonstrate, so the
  // sentence disappears rather than lying when there is nothing to report.
  const paidLine =
    payoutsAmount !== null && payoutsAmount > 0 && creatorsPaid
      ? `Since launch, ${kes(payoutsAmount)} has been paid out to ${creatorsPaid} creator${creatorsPaid === 1 ? "" : "s"} through the platform.`
      : null;

  const faq = [
    {
      question: "How do writers earn on connectPlus?",
      answer:
        "Every read, comment, like and follow on your stories contributes toward your earning potential. Build a consistent publishing habit, earn repeat readers with quality prose, and your dashboard shows the running total.",
    },
    {
      question: "When can I start earning?",
      answer:
        "Monetisation unlocks once your account is verified and your stories are approved. From then on a live earnings summary on your dashboard tracks engagement as it grows.",
    },
    {
      question: "How and when are payouts made?",
      answer:
        "Payouts are processed once you reach the eligibility threshold. They are paid through M-Pesa or PayPal, and each payout shows the gross amount, the platform share and the net you receive.",
    },
    {
      question: "How are the earnings calculated?",
      answer:
        "There are no hidden formulas and no opaque quotas. Your dashboard shows exactly how each amount was calculated, and support is happy to walk through the numbers in detail.",
    },
  ];

  return (
    <>
      <PageJsonLd path="/monetize" title="Monetize" description={DESCRIPTION} />
      <FaqJsonLd path="/monetize" questions={faq} />
      <StaticPage
        icon={<Wallet className="w-3.5 h-3.5 text-brand-400" />}
        title="Monetize your voice"
        subtitle="Write what you love, and earn from the readers who love it back."
        stats={<StatGrid stats={stats} columns={5} />}
        faq={faq}
        sections={[
          {
            heading: "How writers earn",
            body: `Readers, comments, and engagement aren't just validation — on connectPlus they're a pathway to income. Every interaction with your stories contributes toward your earning potential${paidLine ? ` ${paidLine}` : ""}`,
            items: [
              "Grow a consistent publishing habit to build your audience",
              "High-quality prose earns repeat readers who drive engagement",
              "Payouts are processed once you reach the eligibility threshold",
            ],
          },
          {
            heading: "Getting started",
            body: "Once your account is verified and your stories are approved, monetization unlocks on your profile. Watch a live earnings summary from your dashboard as engagement grows.",
          },
          {
            heading: "How payouts work",
            body: "Payouts settle through M-Pesa or PayPal. Each one records the gross tips it settles, the platform share withheld, and the net amount sent, so the balance is always reconstructible rather than promised.",
          },
          {
            heading: "Fair & transparent",
            body: "No hidden formulas, no opaque quotas. Your dashboard shows exactly how your earnings are calculated, and support is happy to explain the numbers in detail.",
          },
        ]}
        updatedAt="14 September 2026"
      />
    </>
  );
}
