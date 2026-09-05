import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "Help Center | connectPlus",
  description: "Answers to common questions about writing, reading, accounts, and payments on connectPlus.",
};

export default function HelpPage() {
  return (
    <StaticPage
      icon={<LifeBuoy className="w-3.5 h-3.5 text-brand-400" />}
      title="Help Center"
      subtitle="Quick answers to the questions we hear most from the connectPlus community."
      updatedAt="5 September 2026"
      sections={[
        {
          heading: "Getting started",
          body: "Create a free account to start writing and reading. After signup, complete your profile with a name, photo, and short bio — writers with complete profiles get noticed faster.",
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
          body: "Keep your password strong and never share it. If you suspect your account has been compromised, change your password immediately and contact support at support@connectplus.io.",
        },
        {
          heading: "Payments & monetization",
          body: "Once eligible, writers can earn engagement on stories and manage payouts from their dashboard. Payments are processed securely and verified before release.",
        },
      ]}
    />
  );
}