import type { Metadata } from "next";
import { BookOpen, Globe2, LifeBuoy, Tags, Users } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";
import { StatGrid } from "@/components/ui/StatGrid";
import { PageJsonLd } from "@/components/seo/PageJsonLd";
import { FaqJsonLd } from "@/components/seo/FaqJsonLd";
import { getPlatformFacts } from "@/lib/platform-facts";
import { formatCompact } from "@/lib/format-views";
import { BRAND_NAME, BRAND_SUPPORT_EMAIL } from "@/lib/brand";

export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Answers to the questions people ask most about connectPlus — how to create an account, write and publish a story, keep your account secure, and get paid through the writer monetisation programme.";

export const metadata: Metadata = {
  title: "Help Center",
  description: DESCRIPTION,
  keywords: [
    "connectPlus help",
    "how to publish a story Kenya",
    "reset connectPlus password",
    "writer monetisation Kenya",
    "connectPlus account security",
  ],
  alternates: { canonical: "/help" },
  robots: { index: true, follow: true },
  openGraph: { title: "Help Center · connectPlus", description: DESCRIPTION, type: "website", url: "/help" },
  twitter: { card: "summary", title: "Help Center · connectPlus", description: DESCRIPTION },
};

export default async function HelpPage() {
  const facts = await getPlatformFacts();
  const { publishedStories, writers, reads, categories } = facts;

  const stats = [
    { label: "Stories published", value: publishedStories, icon: BookOpen },
    { label: "Writers", value: writers, icon: Users },
    { label: "Reads", value: reads, icon: Globe2 },
    { label: "Categories", value: categories, icon: Tags },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: formatCompact(s.value as number), icon: s.icon }));

  // The same questions the page renders below — the visible copy and the
  // schema must agree, so they are defined once and used for both.
  const faq = [
    {
      question: "How do I start writing on connectPlus?",
      answer:
        "Create a free account with your email, verify it to unlock publishing, then open the Studio. Add an avatar and a short bio to your profile — writers with complete profiles get noticed faster.",
    },
    {
      question: "Are my drafts private?",
      answer:
        "Yes. Drafts stay private until you publish them. They are saved automatically as you write, and only you can see them until a story goes live.",
    },
    {
      question: "What happens to my story after I publish it?",
      answer:
        "New stories pass through our moderation pipeline, which pre-screens for spam and policy issues with AI while a human reviews anything flagged. Approved stories appear on the feed immediately. You can edit a published story at any time.",
    },
    {
      question: "Can I edit a story after publishing it?",
      answer:
        "Yes — open the story from your Studio and edit it whenever you like. If a fact changes, edit the piece and add a short dated note rather than silently rewriting it; the Writing Guidelines explain why.",
    },
    {
      question: "How do I keep my account secure?",
      answer:
        "Use a strong, unique password and never share it. If you suspect your account has been compromised, change your password immediately and email support — we will help you lock it down.",
    },
    {
      question: "How do writers get paid?",
      answer:
        "Once your account is verified, your stories are approved, and you have built a readership, monetisation unlocks on your profile. A live earnings summary on your dashboard shows exactly how each amount was calculated, and payouts are processed once you reach the eligibility threshold.",
    },
  ];

  const categoriesLine =
    categories !== null
      ? `Stories are filed across ${formatCompact(categories)} categories so a reader can find you by subject rather than by luck.`
      : "Stories are filed by category so a reader can find you by subject rather than by luck.";

  return (
    <>
      <PageJsonLd path="/help" title="Help Center" description={DESCRIPTION} />
      <FaqJsonLd path="/help" questions={faq} />
      <StaticPage
        icon={<LifeBuoy className="w-3.5 h-3.5 text-brand-400" />}
        title="Help Center"
        subtitle="Quick answers to the questions we hear most from the connectPlus community — and the live numbers behind them."
        stats={<StatGrid stats={stats} columns={4} />}
        faq={faq}
        sections={[
          {
            heading: "Getting started",
            body: `Create a free account to start writing and reading. After signup, complete your profile with a name, photo, and short bio — writers with complete profiles get noticed faster. ${categoriesLine}`,
            items: [
              "Sign up with your email in under a minute",
              "Verify your email to unlock publishing",
              "Add an avatar and bio on your profile",
            ],
          },
          {
            heading: "Writing & publishing",
            body: "Open the Studio, write your story, then publish. Drafts are saved automatically. New stories pass through our moderation pipeline — approved stories appear on the feed immediately.",
            items: [
              "Drafts stay private until you publish",
              "Categories and tags help readers find you",
              "You can edit published stories anytime",
            ],
          },
          {
            heading: "Accounts & security",
            body: `Keep your password strong and never share it. If you suspect your account has been compromised, change your password immediately and contact support at ${BRAND_SUPPORT_EMAIL}.`,
          },
          {
            heading: "Payments & monetization",
            body: "Once eligible, writers can earn engagement on stories and manage payouts from their dashboard. Payments are processed securely and verified before release.",
          },
          {
            heading: "Still stuck?",
            body: `If your question is not answered here, the Contact page lists the fastest way to reach the ${BRAND_NAME} team. Support requests are answered within one business day.`,
          },
        ]}
        updatedAt="14 September 2026"
      />
    </>
  );
}
