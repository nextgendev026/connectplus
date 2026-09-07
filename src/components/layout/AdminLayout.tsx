"use client";

import { SessionProvider } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BrainCircuit,
  ShieldCheck,
  BarChart3,
  Users,
  Rss,
  Layers,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/ui/Logo";
import BrainChatWidget from "@/components/admin/BrainChatWidget";

const ADMIN_LINKS = [
  { href: "/admin", label: "Command Center", icon: LayoutDashboard },
  { href: "/admin/neural", label: "Neural Mind", icon: BrainCircuit },
  { href: "/admin/ai", label: "AI Pipelines", icon: Layers },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldCheck },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/users", label: "Users & Nodes", icon: Users },
  { href: "/admin/rss", label: "RSS Feeds", icon: Rss },
];

function isActive(href: string, pathname: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <SessionProvider>
      <div className="flex min-h-screen bg-surface-950">
        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-64 flex-col border-r border-surface-800/50 bg-surface-900/50">
          <div className="flex h-16 items-center border-b border-surface-800/50 px-6">
            <Logo size="sm" />
            <span className="ml-2 rounded bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
              ADMIN
            </span>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            {ADMIN_LINKS.map((link) => {
              const active = isActive(link.href, pathname);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    active
                      ? "bg-gradient-to-r from-brand-500/15 to-accent-coral/5 text-brand-400 border border-brand-500/20"
                      : "text-surface-400 hover:bg-surface-800 hover:text-surface-50"
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-surface-800/50 p-4">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-500 hover:text-surface-50 hover:bg-surface-800 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Back to Site
            </Link>
          </div>
        </aside>

        <div className="flex flex-1 flex-col min-w-0">
          <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-surface-800/50 bg-surface-900/30 px-4 sm:px-6 backdrop-blur-sm">
            <div className="flex items-center gap-3 min-w-0">
              {/* Mobile logo */}
              <span className="lg:hidden shrink-0">
                <Logo size="sm" />
              </span>
              <h1 className="truncate text-base sm:text-lg font-semibold text-surface-50">
                Admin Panel
              </h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-2 rounded-full bg-surface-800/50 px-3 py-1.5 border border-surface-700">
                <span className="h-2 w-2 rounded-full bg-brand-400 animate-pulse" />
                <span className="hidden sm:inline text-xs text-surface-400">
                  Hive Mind Active
                </span>
              </div>
            </div>
          </header>

          {/* Mobile nav — sticky pills so admins can switch sections on phones */}
          <nav
            className="lg:hidden sticky top-0 z-40 border-b border-surface-800/50 bg-surface-950/90 backdrop-blur-md overflow-x-auto scrollbar-hide"
            aria-label="Admin sections"
          >
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              {ADMIN_LINKS.map((link) => {
                const active = isActive(link.href, pathname);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-medium transition-all duration-200 whitespace-nowrap",
                      active
                        ? "bg-gradient-to-r from-brand-500 to-accent-coral text-white shadow-glow"
                        : "bg-surface-800/70 text-surface-400 hover:text-surface-50 hover:bg-surface-800 border border-surface-700/50"
                    )}
                  >
                    <link.icon className="h-3.5 w-3.5" />
                    {link.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <BrainChatWidget />
    </SessionProvider>
  );
}