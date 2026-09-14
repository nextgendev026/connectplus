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
      updatedAt="14 September 2026"
      sections={[
        {
          heading: "Your account",
          body: "You are responsible for safeguarding your account credentials and for everything published under your account. Keep your email verified and report suspicious activity immediately. You may sign in with a password or with Google; either way, the account and everything on it is your responsibility.",
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
          heading: "Memberships and billing",
          body: "Paid plans are billed in advance for the period you choose — monthly or yearly. M-Pesa payments are settled in Kenyan shillings at the rate shown at checkout; PayPal payments are settled in US dollars and converted by PayPal for your card. We charge the price displayed on the pricing page at the moment you pay, and we will always show you the amount before you approve it. Your plan is activated as soon as the provider confirms the payment. A payment you abandon on your handset never charges you, and an expired or cancelled prompt has no cost.",
        },
        {
          heading: "Renewals, cancellation and refunds",
          body: "M-Pesa memberships are bought one period at a time and do not auto-renew: nothing is deducted from your M-Pesa wallet again unless you deliberately buy another period. PayPal memberships renew automatically through PayPal until you cancel. You can cancel at any time from your settings, which stops the next charge; you keep access until the end of the period you already paid for. Cancelling does not refund the current period. If a charge was taken in error, if you were billed twice, or if the service was unavailable for a sustained period, contact billing@connectplus.io within 30 days and we will make it right, including a full refund where that is the fair outcome. Refunds are returned through the same rail the payment came from.",
        },
        {
          heading: "Failed payments",
          body: "If a payment cannot be completed — insufficient M-Pesa balance, a declined card, or a lapsed PayPal mandate — your plan is not activated, or a renewal lapses, and you move to the free experience. You will not be charged a penalty, and you can pay again at any time from the pricing page.",
        },
        {
          heading: "Moderation & removal",
          body: "We moderate content to keep the community safe. Content that violates these terms may be removed, and repeat offenders may lose access. Our AI supports human moderators — it never makes final decisions alone.",
        },
        {
          heading: "Betting information, not advice",
          body: "The sports desk publishes probabilistic model output for information and entertainment. It is not financial advice, no prediction is a certainty, and we take no stake in any bet you place with a third party. Most markets we write about are 18+.",
        },
        {
          heading: "Liability",
          body: "connectPlus is provided as-is. To the fullest extent permitted by law, we are not liable for indirect or consequential damages arising from your use of the platform. Our total liability is limited to the fees you've paid us in the twelve months before the claim.",
        },
      ]}
    />
  );
}
