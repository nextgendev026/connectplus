"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import Logo from "@/components/ui/Logo";
import { useSiteConfig } from "@/hooks/useSiteConfig";

/**
 * Official connectPlus social profiles.
 *
 * Hard-coded rather than configurable because these are *our* accounts, not a
 * per-deployment setting — and because the previous entries were `href="#"`
 * placeholders, which render as links that go nowhere (bad for readers, and
 * crawled as dead links).
 *
 * `handleKey` marks the entries whose URL is derived from the site's own handle
 * setting, so renaming the account is still a one-field change in
 * Admin → Settings rather than a code edit.
 */
const SOCIAL_LINKS: {
  label: string;
  href: string;
  handleKey?: boolean;
}[] = [
  {
    label: "X (Twitter)",
    href: "https://twitter.com/connectplus",
    handleKey: true,
  },
  {
    label: "Facebook",
    href: "https://www.facebook.com/profile.php?id=61593971836662",
  },
];

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.412c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
    </svg>
  );
}

const FOOTER_LINKS = {
  platform: [
    { label: "Live Scores", href: "/sports" },
    { label: "Betting Tips", href: "/sports?tab=tips" },
    { label: "Live Radio", href: "/radio" },
    { label: "Trending", href: "/trending" },
  ],
  creators: [
    { label: "Write", href: "/studio" },
    { label: "Categories", href: "/categories" },
    { label: "Guidelines", href: "/guidelines" },
    { label: "Monetize", href: "/monetize" },
  ],
  legal: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Help Center", href: "/help" },
    { label: "Pricing", href: "/pricing" },
    { label: "System Status", href: "/status" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
  ],
};

export default function Footer() {
  // Footer is reached through PublicLayout, which is a client component, so the
  // handle comes from the shared client config hook rather than a server read.
  const siteConfig = useSiteConfig();
  const handle = (siteConfig?.twitterHandle ?? "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 15);

  const socials = SOCIAL_LINKS.map((social) =>
    social.handleKey && handle ? { ...social, href: `https://twitter.com/${handle}` } : social
  );

  return (
    <footer className="border-t border-surface-800/50 bg-surface-950">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 py-12 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center">
              <Logo size="sm" />
            </div>
            <p className="mt-3 text-sm text-surface-500 leading-relaxed">
              Voices of the Silicon Savanna — homegrown stories, tech, and
              ideas from Nairobi to Kigali, plus live radio and real-time
              sports scores with model-generated betting insight.
              Karibu nyumbani.
            </p>
            <div className="mt-4 flex items-center gap-2">
              {socials.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`connectPlus on ${social.label}`}
                  title={`connectPlus on ${social.label}`}
                  className="grid h-9 w-9 place-items-center rounded-full border border-surface-800 bg-surface-900 text-surface-400 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/40 hover:text-brand-400 hover:shadow-lg hover:shadow-brand-500/10"
                >
                  {social.label === "Facebook" ? (
                    <FacebookIcon className="h-4 w-4" />
                  ) : (
                    <XIcon className="h-4 w-4" />
                  )}
                </a>
              ))}
            </div>
          </div>

          {Object.entries(FOOTER_LINKS).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-400">
                {category}
              </h3>
              <ul className="mt-3 space-y-2">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-surface-500 hover:text-surface-50 transition-colors"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-surface-800/50 py-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <p className="text-xs text-surface-600">
              &copy; {new Date().getFullYear()} connectPlus. All rights reserved.
            </p>
            <p className="flex items-center gap-1 text-xs text-surface-600">
              Crafted with <Heart className="h-3 w-3 text-red-500" /> in the Silicon Savanna
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
