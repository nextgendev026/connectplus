"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search, Menu, X, PenLine, Shield, LogOut, User, Settings,
  Sun, Moon, Home, Flame, LayoutGrid, Radio, Sparkles, Trophy,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/ThemeContext";
import Logo from "@/components/ui/Logo";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useSiteConfig } from "@/hooks/useSiteConfig";

const NAV_LINKS = [
  { href: "/", label: "Feed", icon: Home, hint: "Latest stories" },
  { href: "/trending", label: "Trending", icon: Flame, hint: "What's hot" },
  { href: "/categories", label: "Categories", icon: LayoutGrid, hint: "Browse topics" },
  { href: "/radio", label: "Radio", icon: Radio, hint: "Live stations" },
  { href: "/sports", label: "Sports", icon: Trophy, hint: "Scores & tips" },
  { href: "/pricing", label: "Pricing", icon: Sparkles, hint: "Plans" },
];

/**
 * A nav link is active for its own route and any child route, so `/sports?tab=tips`
 * or a future `/sports/xyz` keeps the Sports pill lit instead of leaving the bar
 * with nothing highlighted.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const siteConfig = useSiteConfig();

  const user = session?.user;
  const navLinks = useMemo(
    () => NAV_LINKS.filter((l) => !(l.href === "/radio" && siteConfig && !siteConfig.features.radio)),
    [siteConfig]
  );
  const signupsEnabled = siteConfig ? siteConfig.features.signups : true;

  const activeHref = navLinks.find((l) => isActive(pathname, l.href))?.href ?? null;

  // The bar deepens once the page moves, which separates it from content
  // scrolling underneath instead of leaving a flat 1px line holding the whole
  // thing together.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    // Sync once so a page opened mid-scroll starts with the right bar state.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet on navigation, otherwise it stays open over the page
  // the reader just asked for.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to a route change
    setMobileOpen(false);
  }, [pathname]);

  return (
    <nav
      className={cn(
        "sticky top-0 z-50 border-b transition-all duration-300",
        scrolled
          ? "border-surface-800/70 bg-surface-950/85 shadow-[0_8px_30px_-12px_rgb(0_0_0/0.45)] backdrop-blur-xl"
          : "border-surface-800/40 bg-surface-950/70 backdrop-blur-lg"
      )}
    >
      {/* Brand wash along the top edge — reads as a lit surface rather than flat chrome. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-500/40 to-transparent" />
      <div className="pointer-events-none absolute -top-16 left-1/4 h-32 w-1/2 rounded-full bg-brand-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 lg:gap-6">
            <Logo />

            <DesktopNav links={navLinks} activeHref={activeHref} />
          </div>

          <div className="flex items-center gap-1.5">
            {searchOpen ? (
              <form action="/search" method="GET" className="flex animate-scale-in items-center gap-1.5">
                <input
                  type="text"
                  name="q"
                  placeholder="Search stories…"
                  className="w-40 rounded-xl border border-surface-700 bg-surface-800/80 px-3 py-1.5 text-sm text-surface-50 placeholder-surface-500 transition focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/25 sm:w-56"
                  autoFocus
                />
                <IconButton type="submit" label="Submit search">
                  <Search className="h-4 w-4" />
                </IconButton>
                <IconButton type="button" label="Close search" onClick={() => setSearchOpen(false)}>
                  <X className="h-4 w-4" />
                </IconButton>
              </form>
            ) : (
              <IconButton label="Search" href="/search">
                <Search className="h-4 w-4" />
              </IconButton>
            )}

            <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </IconButton>

            {/* The EN/SW toggle that used to sit here flipped local state and
                nothing else — no routing, no dictionary, no persisted choice. A
                control that promises a language and delivers a label is worse
                than no control: it is the first thing a Swahili speaker taps.
                It comes back when there is a translation to switch to, and the
                mobile sheet carries the honest version of this row. */}

            {session ? (
              <div className="hidden items-center gap-1.5 sm:flex">
                <NotificationBell />
                {user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" ? (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 text-xs font-semibold text-accent-amber transition-colors hover:bg-amber-500/20"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Admin
                  </Link>
                ) : null}
                <Link
                  href="/studio"
                  className="btn-gradient flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Write
                </Link>
                <AccountMenu
                  username={user?.username}
                  avatar={user?.avatar ?? null}
                />
              </div>
            ) : (
              <div className="hidden items-center gap-1.5 sm:flex">
                <Link
                  href="/auth/signin"
                  className="rounded-xl px-3 py-1.5 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800/70 hover:text-surface-50"
                >
                  Sign in
                </Link>
                {signupsEnabled && (
                  <Link
                    href="/auth/signup"
                    className="btn-gradient rounded-xl px-3.5 py-1.5 text-sm font-semibold text-white"
                  >
                    Get started
                  </Link>
                )}
              </div>
            )}

            {/* The bell, reachable on a phone.
             *
             * It used to live only inside the `sm:flex` account group, so below
             * 640px a signed-in reader saw a logo, a search button and a menu —
             * and nothing at all when an alert was waiting for them. On the
             * device where push most often drives the visit, the notification
             * affordance was simply absent. Desktop keeps the one in the account
             * row, so the two never both appear. */}
            {session && (
              <div className="flex items-center sm:hidden">
                <NotificationBell />
              </div>
            )}

            <IconButton
              label={mobileOpen ? "Close menu" : "Open menu"}
              onClick={() => setMobileOpen((open) => !open)}
              className="md:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </IconButton>
          </div>
        </div>

        {mobileOpen && (
          <div className="animate-slide-down border-t border-surface-800 py-3 md:hidden">
            <MobileMenu
              links={navLinks}
              pathname={pathname}
              session={Boolean(session)}
              username={user?.username}
              isAdmin={user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"}
              signupsEnabled={signupsEnabled}
            />
          </div>
        )}
      </div>
    </nav>
  );
}

/**
 * Desktop navigation with a sliding highlight.
 *
 * The indicator is measured from the active link rather than animated per-item,
 * so the bar reads as one moving object instead of six independent fades — the
 * detail that makes it feel current rather than themed. It stays `null` until a
 * measurement exists, which keeps it purely decorative: if measurement ever
 * fails, the bar still renders correctly with no indicator.
 */
function DesktopNav({
  links,
  activeHref,
}: {
  links: typeof NAV_LINKS;
  activeHref: string | null;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const linkRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const el = activeHref ? linkRefs.current[activeHref] : null;
    if (!el) {
      setIndicator(null);
      return;
    }

    /**
     * A zero width means the row is `display:none` — this component is hidden
     * below `md`. Writing that measurement would render a zero-width pill, and
     * worse, the ResizeObserver never fires for a hidden element, so widening
     * the window would leave the artifact on screen. Reporting "no measurement"
     * instead keeps the indicator purely additive.
     */
    const measure = () => {
      const width = el.offsetWidth;
      setIndicator(width > 0 ? { left: el.offsetLeft, width } : null);
    };

    measure();
    // Fonts loading, or the list shrinking when radio is disabled, shifts the
    // row — so re-measure rather than trusting the first read.
    const observer = new ResizeObserver(measure);
    if (listRef.current) observer.observe(listRef.current);
    // The observer is attached to a hidden container, which reports no size
    // changes, so the breakpoint crossing needs its own trigger.
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [activeHref, links]);

  return (
    <div ref={listRef} className="relative hidden items-center gap-0.5 md:flex">
      {indicator && (
        <span
          aria-hidden
          className="absolute inset-y-0 rounded-xl border border-brand-500/30 bg-gradient-to-b from-brand-500/25 to-brand-500/5 shadow-[0_0_20px_-4px_rgb(255_107_0/0.45)] transition-all duration-300 ease-out"
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {links.map((link) => {
        const active = link.href === activeHref;
        return (
          <Link
            key={link.href}
            href={link.href}
            ref={(el) => {
              linkRefs.current[link.href] = el;
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-200",
              active ? "text-brand-300" : "text-surface-400 hover:text-surface-50"
            )}
          >
            <link.icon
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                active ? "text-brand-400" : "text-surface-500 group-hover:scale-110 group-hover:text-surface-300"
              )}
            />
            <span className="leading-none">{link.label}</span>
            {active && (
              <span
                aria-hidden
                className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-400 shadow-[0_0_8px_rgb(255_107_0/0.8)]"
              />
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** Compact icon button shared by search, theme and menu controls. */
function IconButton({
  children,
  label,
  onClick,
  href,
  type = "button",
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  type?: "button" | "submit";
  className?: string;
}) {
  const classes = cn(
    "grid h-9 w-9 place-items-center rounded-xl border border-transparent text-surface-400 transition-all duration-200 hover:border-surface-700 hover:bg-surface-800/70 hover:text-surface-50",
    className
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-label={label} title={label}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} className={classes} aria-label={label} title={label}>
      {children}
    </button>
  );
}

/**
 * Avatar menu. Uses a real open state plus outside-click handling instead of the
 * previous hover-only reveal, which made the menu unreachable on touch devices
 * and by keyboard.
 */
function AccountMenu({ username, avatar }: { username?: string; avatar: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={cn(
          "flex items-center gap-1 rounded-xl border p-0.5 pr-1.5 transition-colors",
          open ? "border-brand-500/40 bg-surface-800/70" : "border-surface-700 hover:border-surface-600 hover:bg-surface-800/60"
        )}
      >
        <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-lg bg-surface-800">
          {avatar ? (
            <Image src={avatar} alt="" width={28} height={28} className="h-full w-full object-cover" />
          ) : (
            <User className="h-4 w-4 text-surface-400" />
          )}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-surface-500 transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-2 w-52 animate-scale-in">
          <div className="surface-raised overflow-hidden rounded-2xl p-1.5">
            <Link
              href={`/profile/${username}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50"
            >
              <User className="h-4 w-4 text-surface-500" />
              Profile
            </Link>
            <Link
              href="/settings"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50"
            >
              <Settings className="h-4 w-4 text-surface-500" />
              Settings
            </Link>
            <div className="my-1 h-px bg-surface-800" />
            <button
              role="menuitem"
              onClick={() => signOut()}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-surface-300 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mobile sheet: sectioned tiles instead of a flat list of text rows. */
function MobileMenu({
  links,
  pathname,
  session,
  username,
  isAdmin,
  signupsEnabled,
}: {
  links: typeof NAV_LINKS;
  pathname: string;
  session: boolean;
  username?: string;
  isAdmin: boolean;
  signupsEnabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {links.map((link) => {
          const active = isActive(pathname, link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-2xl border p-3 transition-all duration-200",
                active
                  ? "border-brand-500/35 bg-gradient-to-br from-brand-500/20 to-brand-500/5"
                  : "border-surface-800 bg-surface-900/60 active:scale-[0.98]"
              )}
            >
              <span
                className={cn(
                  "grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-colors",
                  active ? "bg-brand-500/20 text-brand-300" : "bg-surface-800 text-surface-400"
                )}
              >
                <link.icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-sm font-semibold", active ? "text-brand-200" : "text-surface-200")}>
                  {link.label}
                </span>
                <span className="block truncate text-[10px] uppercase tracking-wider text-surface-500">{link.hint}</span>
              </span>
            </Link>
          );
        })}
      </div>

      {session ? (
        <div className="flex flex-col gap-2 border-t border-surface-800 pt-3">
          <Link
            href={`/profile/${username}`}
            className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/60 p-3 text-sm font-medium text-surface-300"
          >
            <User className="h-4 w-4 text-surface-500" />
            My profile
          </Link>
          <Link href="/studio" className="btn-gradient rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white">
            <PenLine className="mr-1.5 inline h-4 w-4" />
            Write a story
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              className="flex items-center gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm font-semibold text-accent-amber"
            >
              <Shield className="h-4 w-4" />
              Admin console
            </Link>
          )}
          <Link href="/settings" className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/60 p-3 text-sm font-medium text-surface-300">
            <Settings className="h-4 w-4 text-surface-500" />
            Settings
          </Link>
          <button
            onClick={() => signOut()}
            className="flex items-center gap-3 rounded-2xl border border-surface-800 bg-surface-900/60 p-3 text-left text-sm font-medium text-surface-300 transition-colors hover:text-red-400"
          >
            <LogOut className="h-4 w-4 text-surface-500" />
            Sign out
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 border-t border-surface-800 pt-3">
          <Link
            href="/auth/signin"
            className="rounded-2xl border border-surface-800 bg-surface-900/60 px-4 py-3 text-center text-sm font-semibold text-surface-200"
          >
            Sign in
          </Link>
          {signupsEnabled && (
            <Link href="/auth/signup" className="btn-gradient rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white">
              Get started
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
