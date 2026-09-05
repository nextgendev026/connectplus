import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "Terms of Service | connectPlus",
  description: "The terms that govern your use of the connectPlus platform.",
};

export default function TermsPage() {
  return (
    <StaticPage
      icon={<ScrollText className="w-3.5 h-3.5 text-brand-400" />}
      title="Terms of Service"
      subtitle="The simple rules that keep connectPlus running fairly for everyone."
      updatedAt="5 September 2026"
      sections={[
        {
          heading: "Your account",
          body: "You are responsible for safeguarding your account credentials and for everything published under your account. Keep your email verified and report suspicious activity immediately.",
        },
        {
          heading: "Content you publish",
          body: "You retain ownership of the stories you write. By publishing on connectPlus, you grant us a license to host and display that content so readers can access it. You must have the right to publish everything you share.",
        },
        {
          heading: "Acceptable use",
          body: "Don't use connectPlus to break the law, harm others, or disrupt the platform. Specifically prohibited: spam, malware, hate speech, harassment, impersonation, and publishing content you don't own.",
        },
        {
          heading: "Moderation & removal",
          body: "We moderate content to keep the community safe. Content that violates these terms may be removed, and repeat offenders may lose access. Our AI supports human moderators — it never makes final decisions alone.",
        },
        {
          heading: "Liability",
          body: "connectPlus is provided as-is. To the fullest extent permitted by law, we are not liable for indirect or consequential damages arising from your use of the platform. Our total liability is limited to the fees you've paid us in the twelve months before the claim.",
        },
      ]}
    />
  );
}