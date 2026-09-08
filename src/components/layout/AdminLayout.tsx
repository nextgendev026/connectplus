"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  BrainCircuit,
  ShieldCheck,
  PenLine,
  BarChart3,
  Users,
  Rss,
  Layers,
  ChevronLeft,
  Menu,
  X,
  Settings2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/ui/Logo";
import BrainChatWidget from "@/components/admin/BrainChatWidget";

const ADMIN_LINKS = [
  { href: "/admin", label: "Command Center", icon: LayoutDashboard },
  { href: "/admin/neural", label: "Neural Mind", icon: BrainCircuit },
  { href: "/admin/ai", label: "AI Pipelines", icon: Layers },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldCheck },
  { href: "/admin/writers", label: "Verified Writers", icon: PenLine },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/users", label: "Users & Nodes", icon: Users },
  { href: "/admin/rss", label: "RSS Feeds", icon: Rss },
  { href: "/admin/settings", label: "Settings & Integrations", icon: Settings2 },
];

function isActive(href: string, pathname: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function AdminNavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex-1 space-y-1 p-4">
      {ADMIN_LINKS.map((link) => {
        const active = isActive(link.href, pathname);
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
              active
                ? "bg-gradient-to-r from-brand-500/15 to-accent-coral/5 text-accent-strong border border-brand-500/20"
                : "text-surface-400 hover:bg-surface-800 hover:text-surface-50"
            )}
          >
            <link.icon className="h-4 w-4" />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeLink = ADMIN_LINKS.find((l) => isActive(l.href, pathname));

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

          <AdminNavItems pathname={pathname} />

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
          <header className="flex h-14 sm:h-16 shrink-0 items-center justify-between gap-3 border-b border-surface-800/50 bg-surface-900/30 px-3 sm:px-6 backdrop-blur-sm sticky top-0 z-40">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              {/* Mobile menu trigger */}
              <button
                onClick={() => setDrawerOpen(true)}
                className="lg:hidden rounded-lg p-2 text-surface-400 hover:text-surface-50 hover:bg-surface-800 transition-colors"
                aria-label="Open admin navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              {/* Mobile logo */}
              <span className="lg:hidden shrink-0">
                <Logo size="sm" />
              </span>
              <div className="min-w-0">
                <p className="hidden sm:block text-[10px] font-semibold uppercase tracking-wider text-surface-500">
                  Admin Panel
                </p>
                <h1 className="truncate text-sm sm:text-base font-semibold text-surface-50">
                  {activeLink?.label ?? "Command Center"}
                </h1>
              </div>
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

          {/* Mobile slide-over nav */}
          {drawerOpen && (
            <div className="fixed inset-0 z-50 lg:hidden">
              <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setDrawerOpen(false)}
              />
              <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-surface-800/50 bg-surface-900 shadow-2xl animate-slide-in">
                <div className="flex h-14 items-center justify-between border-b border-surface-800/50 px-4">
                  <div className="flex items-center gap-2">
                    <Logo size="sm" />
                    <span className="rounded bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      ADMIN
                    </span>
                  </div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="rounded-lg p-1.5 text-surface-400 hover:text-surface-50 hover:bg-surface-800 transition-colors"
                    aria-label="Close admin navigation"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <AdminNavItems pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
                <div className="border-t border-surface-800/50 p-4">
                  <Link
                    href="/"
                    onClick={() => setDrawerOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-500 hover:text-surface-50 hover:bg-surface-800 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Back to Site
                  </Link>
                </div>
              </div>
            </div>
          )}

          <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 min-w-0">{children}</main>
        </div>
      </div>
      <BrainChatWidget />
    </SessionProvider>
  );
}