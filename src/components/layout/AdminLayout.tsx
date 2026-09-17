"use client";

import { useEffect, useState } from "react";
import { SessionProvider } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  LayoutDashboard,
  BrainCircuit,
  ShieldCheck,
  PenLine,
  BarChart3,
  Users,
  Rss,
  Layers,
  FileText,
  Megaphone,
  CreditCard,
  Banknote,
  FolderTree,
  ChevronLeft,
  Menu,
  X,
  Settings2,
  Plug,
  Trophy,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Logo from "@/components/ui/Logo";
import BrainChatWidget from "@/components/admin/BrainChatWidget";

/**
 * The console's navigation, grouped the way an operator thinks about the work
 * rather than the order the pages happened to be built in.
 *
 * Sixteen flat links is a wall: nothing signals that "Moderation" and "Verified
 * Writers" belong to the same job, and finding a page means reading all sixteen
 * every time. Five groups of two to five keep each decision small.
 */
const NAV_GROUPS: { title: string; links: { href: string; label: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    title: "Overview",
    links: [
      { href: "/admin", label: "Command Center", icon: LayoutDashboard },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    title: "Intelligence",
    links: [
      { href: "/admin/neural", label: "Neural Mind", icon: BrainCircuit },
      { href: "/admin/ai", label: "AI Pipelines", icon: Layers },
    ],
  },
  {
    title: "Editorial",
    links: [
      { href: "/admin/content", label: "Content Console", icon: FileText },
      { href: "/admin/moderation", label: "Moderation", icon: ShieldCheck },
      { href: "/admin/writers", label: "Verified Writers", icon: PenLine },
      { href: "/admin/categories", label: "Categories", icon: FolderTree },
      { href: "/admin/rss", label: "RSS Feeds", icon: Rss },
    ],
  },
  {
    title: "Revenue",
    links: [
      { href: "/admin/ads", label: "Monetization", icon: Megaphone },
      { href: "/admin/subscriptions", label: "Subscriptions", icon: CreditCard },
      { href: "/admin/payments", label: "Payments", icon: Banknote },
      { href: "/admin/sports", label: "Sports & Betting", icon: Trophy },
    ],
  },
  {
    title: "Platform",
    links: [
      // Marketing belongs here rather than under Monetization: it is not a
      // revenue surface, it is the platform's own mouth, and what it needs from
      // an operator is the same thing the health console needs — a glance that
      // says whether it ran, not another settings form.
      { href: "/admin/marketing", label: "Marketing", icon: Megaphone },
      { href: "/admin/users", label: "Users & Nodes", icon: Users },
      // Health sits beside Integrations on purpose: that page reports whether a
      // service is configured and reachable, this one reports when each pipeline
      // last actually did its job. Reading the first as the second is how a
      // stalled fold stays invisible for two weeks.
      { href: "/admin/health", label: "Pipeline Health", icon: Activity },
      { href: "/admin/integrations", label: "Integrations", icon: Plug },
      { href: "/admin/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

const ALL_LINKS = NAV_GROUPS.flatMap((group) => group.links);

/**
 * Longest-prefix match, so `/admin` does not light up for `/admin/sports`.
 *
 * The old check special-cased exactly `/admin` and prefix-matched everything
 * else, which meant `/admin/payments` and `/admin/payments/anything` were the
 * only two paths that could ever be considered. Choosing the longest matching
 * href keeps the highlight correct as nested routes appear.
 */
function activeHref(pathname: string): string | undefined {
  return ALL_LINKS.map((link) => link.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

function AdminNavItems({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const current = activeHref(pathname);
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3" aria-label="Admin sections">
      {NAV_GROUPS.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-surface-500">
            {group.title}
          </p>
          <div className="space-y-0.5">
            {group.links.map((link) => {
              const active = current === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // py-2.5 keeps the row a ~40px tap target on a phone; py-2
                    // measured 34px, which is under the comfortable minimum
                    // once the drawer also has to be closed by thumb.
                    "group relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[13px] font-medium transition duration-200",
                    active
                      ? "bg-brand-500/15 text-accent-strong"
                      : "text-surface-400 hover:bg-surface-800 hover:text-surface-50"
                  )}
                >
                  {/* A rail rather than a full border, so the active row does not
                      change height when it is selected. */}
                  <span
                    className={cn(
                      "absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-500 transition-opacity",
                      active ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <link.icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{link.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeLink = ALL_LINKS.find((link) => link.href === activeHref(pathname));

  // Escape closes the drawer, and the page behind it must not scroll while it is
  // open — otherwise a flick on the backdrop scrolls the console under an
  // overlay the reader cannot see.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  return (
    <SessionProvider>
      {/*
        One scroll region, not two.

        The shell used to nest `overflow-y-auto` twice — a `h-screen` column that
        scrolled, containing a `main` that also scrolled — so a wheel over the
        content could move either, the header's `sticky` was measured against the
        wrong box, and phones showed a doubled scroll affordance. The page scrolls
        on the document now; the sidebar and the header are simply sticky within
        it, which is what both were reaching for.
      */}
      <div className="flex min-h-screen bg-surface-950 selection:bg-brand-500/30">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-surface-800 bg-surface-900 lg:flex xl:w-64">
          <div className="flex h-16 shrink-0 items-center gap-2 border-b border-surface-800 px-4">
            <Logo size="sm" />
            <span className="rounded bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
              ADMIN
            </span>
          </div>

          <AdminNavItems pathname={pathname} />

          <div className="shrink-0 border-t border-surface-800 p-3">
            <Link
              href="/"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
            >
              <ExternalLink className="h-4 w-4" />
              View live site
            </Link>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-surface-800 bg-surface-950/85 px-3 backdrop-blur-md sm:h-16 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                onClick={() => setDrawerOpen(true)}
                className="rounded-lg p-2 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50 lg:hidden"
                aria-label="Open admin navigation"
                aria-expanded={drawerOpen}
              >
                <Menu className="h-5 w-5" />
              </button>
              <span className="shrink-0 lg:hidden">
                <Logo size="sm" />
              </span>
              <div className="min-w-0">
                <p className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-surface-500 sm:block">
                  Admin Panel
                </p>
                <h1 className="truncate text-sm font-semibold text-surface-50 sm:text-base">
                  {activeLink?.label ?? "Command Center"}
                </h1>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full border border-surface-700 bg-surface-800/60 px-3 py-1.5 sm:inline-flex">
                <span className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
                <span className="text-[11px] font-medium text-surface-300">Systems live</span>
              </span>
            </div>
          </header>

          <main className="flex-1 p-3 sm:p-4 lg:p-6">{children}</main>
        </div>
      </div>

      {/* Mobile slide-over */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm motion-safe:animate-fade-in"
            onClick={() => setDrawerOpen(false)}
            aria-label="Close admin navigation"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-surface-800 bg-surface-900 shadow-2xl motion-safe:animate-slide-in-left">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-surface-800 px-3">
              <div className="flex items-center gap-2">
                <Logo size="sm" />
                <span className="rounded bg-gradient-to-r from-brand-500 to-accent-coral/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                  ADMIN
                </span>
              </div>
              <button
                onClick={() => setDrawerOpen(false)}
                className="rounded-lg p-2 text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
                aria-label="Close admin navigation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <AdminNavItems pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <div className="shrink-0 border-t border-surface-800 p-3">
              <Link
                href="/"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
              >
                <ChevronLeft className="h-4 w-4" />
                Back to Site
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      <BrainChatWidget />
    </SessionProvider>
  );
}
