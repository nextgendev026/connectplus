import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "Monetize | connectPlus",
  description: "Turn your writing into income on connectPlus — earn from reader engagement.",
};

export default function MonetizePage() {
  return (
    <StaticPage
      icon={<Wallet className="w-3.5 h-3.5 text-brand-400" />}
      title="Monetize your voice"
      subtitle="Write what you love, and earn from the readers who love it back."
      updatedAt="5 September 2026"
      sections={[
        {
          heading: "How writers earn",
          body: "Readers, comments, and engagement aren't just validation — on connectPlus they're a pathway to income. Every interaction with your stories contributes toward your earning potential.",
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
          heading: "Fair & transparent",
          body: "No hidden formulas, no opaque quotas. Your dashboard shows exactly how your earnings are calculated, and support is happy to explain the numbers in detail.",
        },
      ]}
    />
  );
}