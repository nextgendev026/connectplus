import Link from "next/link";
import { Heart } from "lucide-react";
import Logo from "@/components/ui/Logo";

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.7 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 015.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.36.77 1.05.77 2.13v3.16c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

const FOOTER_LINKS = {
  platform: [
    { label: "About", href: "/about" },
    { label: "Contact", href: "/contact" },
    { label: "Help Center", href: "/help" },
    { label: "System Status", href: "/status" },
  ],
  creators: [
    { label: "Write", href: "/studio" },
    { label: "Guidelines", href: "/guidelines" },
    { label: "Monetize", href: "/monetize" },
  ],
  legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Trending", href: "/trending" },
  ],
};

export default function Footer() {
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
              ideas from Nairobi to Kigali. Karibu nyumbani.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a
                href="#"
                aria-label="X (Twitter)"
                className="text-surface-500 hover:text-surface-50 transition-colors"
              >
                <XIcon className="h-4 w-4" />
              </a>
              <a
                href="#"
                aria-label="GitHub"
                className="text-surface-500 hover:text-surface-50 transition-colors"
              >
                <GithubIcon className="h-4 w-4" />
              </a>
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
