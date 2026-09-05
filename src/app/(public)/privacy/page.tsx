import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "Privacy Policy | connectPlus",
  description: "How connectPlus collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <StaticPage
      icon={<ShieldCheck className="w-3.5 h-3.5 text-brand-400" />}
      title="Privacy Policy"
      subtitle="Your data belongs to you. Here's exactly what we collect and why."
      updatedAt="5 September 2026"
      sections={[
        {
          heading: "What we collect",
          body: "We collect the minimum needed to run the platform: your email address, display name, profile details, and the content you publish. We also log basic usage data to keep the service fast and secure.",
        },
        {
          heading: "How we use your data",
          body: "Your information powers the core product: authenticating your account, delivering your feed, showing you relevant stories, and protecting the community from abuse. We never sell your personal data.",
        },
        {
          heading: "Cookies & local storage",
          body: "connectPlus uses cookies and local storage to keep you signed in, remember your theme preference, and store your writing drafts locally so you never lose work.",
        },
        {
          heading: "Your rights",
          body: "You can access, correct, or delete your account information at any time from your profile or by contacting privacy@connectplus.io. When you delete your account, we remove your personal data without unnecessary delay.",
        },
      ]}
    />
  );
}