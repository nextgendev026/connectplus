import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { StaticPage } from "@/components/ui/StaticPage";

export const metadata: Metadata = {
  title: "Contact | connectPlus",
  description: "Get in touch with the connectPlus team — support, feedback, partnerships and press.",
};

export default function ContactPage() {
  return (
    <div>
      <StaticPage
        icon={<MessageCircle className="w-3.5 h-3.5 text-brand-400" />}
        title="Contact us"
        subtitle="We read everything. Whether it's a bug, a feature idea, a partnership, or just a hello — reach out."
        updatedAt="5 September 2026"
        sections={[
          {
            heading: "Support & feedback",
            body: "Having trouble with your account, writing studio, or payments? Our team responds to support requests within one business day. Reach us at support@connectplus.io with the details, and include any errors you're seeing.",
          },
          {
            heading: "Press & partnerships",
            body: "Journalists, institutions, and brands interested in working with connectPlus can reach the team at partners@connectplus.io. We partner with media houses, universities, and community organizations across East Africa.",
          },
        ]}
      />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-20 -mt-2">
        <div className="rounded-3xl border border-surface-800/60 bg-gradient-to-br from-brand-500/8 to-accent-cyan/5 p-8 sm:p-10 text-center">
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