import Link from "next/link";
import { Github, Twitter, Heart } from "lucide-react";
import Logo from "@/components/ui/Logo";

const FOOTER_LINKS = {
  platform: [
    { label: "About", href: "/about" },
    { label: "Careers", href: "/careers" },
    { label: "Blog", href: "/blog" },
  ],
  creators: [
    { label: "Write", href: "/studio" },
    { label: "Guidelines", href: "/guidelines" },
    { label: "Monetize", href: "/monetize" },
  ],
  support: [
    { label: "Help Center", href: "/help" },
    { label: "Contact", href: "/contact" },
    { label: "Status", href: "/status" },
  ],
  legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Cookies", href: "/cookies" },
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
              Stories that connect East Africa. Share your voice with the world.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <a
                href="#"
                className="text-surface-500 hover:text-surface-50 transition-colors"
              >
                <Twitter className="h-4 w-4" />
              </a>
              <a
                href="#"
                className="text-surface-500 hover:text-surface-50 transition-colors"
              >
                <Github className="h-4 w-4" />
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
              Made with <Heart className="h-3 w-3 text-red-500" /> in East Africa
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
