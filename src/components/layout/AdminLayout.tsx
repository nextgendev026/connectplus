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
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/ui/Logo";
import BrainChatWidget from "@/components/admin/BrainChatWidget";

const ADMIN_LINKS = [
  { href: "/admin", label: "Command Center", icon: LayoutDashboard },
  { href: "/admin/neural", label: "Neural Mind", icon: BrainCircuit },
  { href: "/admin/moderation", label: "Moderation", icon: ShieldCheck },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/users", label: "Users & Nodes", icon: Users },
  { href: "/admin/rss", label: "RSS Feeds", icon: Rss },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <SessionProvider>
      <div className="flex min-h-screen bg-surface-950">
        <aside className="hidden lg:flex w-64 flex-col border-r border-surface-800/50 bg-surface-900/50">
          <div className="flex h-16 items-center border-b border-surface-800/50 px-6">
            <Logo size="sm" />
            <span className="ml-2 rounded bg-accent-amber/20 px-1.5 py-0.5 text-[10px] font-bold text-accent-amber">
              ADMIN
            </span>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            {ADMIN_LINKS.map((link) => {
              const isActive =
                link.href === "/admin"
                  ? pathname === "/admin"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-brand-500/10 text-brand-400"
                      : "text-surface-400 hover:bg-surface-800 hover:text-surface-50"
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                  {link.href === "/admin/moderation" && (
                    <span className="ml-auto rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400">
                      3
                    </span>
                  )}
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

        <div className="flex flex-1 flex-col">
          <header className="flex h-16 items-center justify-between border-b border-surface-800/50 bg-surface-900/30 px-6 backdrop-blur-sm">
            <h1 className="text-lg font-semibold text-surface-50">Admin Panel</h1>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full bg-surface-800/50 px-3 py-1.5">
                <div className="h-2 w-2 rounded-full bg-brand-400 animate-pulse" />
                <span className="text-xs text-surface-400">
                  Hive Mind Active
                </span>
              </div>
            </div>
          </header>
          <main className="flex-1 overflow-y-auto p-6">{children}</main>
        </div>
      </div>
      <BrainChatWidget />
    </SessionProvider>
  );
}
