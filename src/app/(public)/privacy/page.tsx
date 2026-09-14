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
      updatedAt="14 September 2026"
      sections={[
        {
          heading: "What we collect",
          body: "We collect the minimum needed to run the platform: your email address, display name, profile details, and the content you publish. We also log basic usage data to keep the service fast and secure. Payment is handled by our providers, so we hold a payment reference and status — never a card number and never your M-Pesa PIN.",
        },
        {
          heading: "How we use your data",
          body: "Your information powers the core product: authenticating your account, delivering your feed, showing you relevant stories, and protecting the community from abuse. We never sell your personal data.",
        },
        {
          heading: "Signing in with Google",
          body: "If you choose \"Continue with Google\", Google tells us your email address, name and profile picture so we can create or match your account. If you already registered with a password, the two are linked to the same account rather than duplicated. We receive no access to your Google password, your Gmail, or any other Google service, and you can keep using a password instead at any time.",
        },
        {
          heading: "Payments and billing",
          body: "We do not process payments ourselves. Two providers do, and they are the only parties that ever see the instruments you pay with: Safaricom (for M-Pesa) and PayPal (for cards and PayPal balances). Both are independent data controllers for the information they collect, and their own privacy policies apply to it. To take a subscription we ask for a phone number when you pay by M-Pesa, and we store that number alongside the payment so your receipts and support requests can be reconciled. We store the provider's reference for each payment (an M-Pesa receipt number or a PayPal capture id), the amount, the currency, the plan bought and the outcome, because that record is what proves your membership and what we must keep for accounting. We never store your M-Pesa PIN, your card number, or your PayPal password — those are entered directly into the provider's own system.",
        },
        {
          heading: "Cookies & local storage",
          body: "connectPlus uses cookies and local storage to keep you signed in, remember your theme preference, and store your writing drafts locally so you never lose work.",
        },
        {
          heading: "Sharing with service providers",
          body: "We use a small number of processors to run the platform: hosting (Vercel), edge caching (Cloudflare), database and file storage (Supabase), and email delivery (Resend). Each receives only what its job requires, and none of them receives your payment credentials.",
        },
        {
          heading: "Retention",
          body: "Account data is kept while your account exists. Payment records and their references are retained after cancellation for as long as tax and accounting rules require, then deleted. Analytics that rely on a visitor cookie use a salted, non-reversible hash rather than an IP address, so unique visits can be counted without identifying anyone.",
        },
        {
          heading: "Your rights",
          body: "You can access, correct, or delete your account information at any time from your profile or by contacting privacy@connectplus.io. When you delete your account, we remove your personal data without unnecessary delay. Deleting your account does not cancel a subscription: cancel it first from your settings, otherwise the provider may keep billing an account that no longer exists.",
        },
      ]}
    />
  );
}
