"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState } from "react";
import {
  Search, Menu, X, PenLine, Shield, LogOut, User, Settings,
  Globe, Sun, Moon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/providers/ThemeContext";
import Logo from "@/components/ui/Logo";

const NAV_LINKS = [
  { href: "/", label: "Feed" },
  { href: "/trending", label: "Trending" },
  { href: "/categories", label: "Categories" },
  { href: "/radio", label: "Radio" },
];

export default function Navbar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [lang, setLang] = useState<"EN" | "SW">("EN");
  const { theme, toggleTheme } = useTheme();

  const user = session?.user;

  return (
    <nav className="sticky top-0 z-50 border-b border-surface-800/50 bg-surface-950/80 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <div className="flex items-center gap-8">
            <Logo />

            <div className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200",
                    pathname === link.href
                      ? "text-brand-400 bg-brand-500/10"
                      : "text-surface-400 hover:text-surface-50 hover:bg-surface-800"
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {searchOpen ? (
              <form
                action="/search"
                method="GET"
                className="flex items-center gap-2 animate-scale-in"
              >
                <input
                  type="text"
                  name="q"
                  placeholder="Search stories..."
                  className="w-48 rounded-lg border border-surface-700 bg-surface-800 px-3 py-1.5 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  autoFocus
                />
                <button
                  type="submit"
                  className="rounded-lg p-1.5 text-surface-400 hover:text-surface-50 hover:bg-surface-800"
                  aria-label="Submit search"
                >
                  <Search className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSearchOpen(false)}
                  className="rounded-lg p-1.5 text-surface-400 hover:text-surface-50 hover:bg-surface-800"
                  aria-label="Close search"
                >
                  <X className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <Link
                href="/search"
                className="rounded-lg p-2 text-surface-400 hover:text-surface-50 hover:bg-surface-800 transition-colors"
                aria-label="Search"
              >
                <Search className="h-4 w-4" />
              </Link>
            )}

            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-surface-400 hover:text-surface-50 hover:bg-surface-800 transition-colors"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            <button
              onClick={() => setLang(lang === "EN" ? "SW" : "EN")}
              className="hidden sm:flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-surface-400 hover:text-surface-50 hover:bg-surface-800 transition-colors"
            >
              <Globe className="h-3 w-3" />
              {lang}
            </button>

            {session ? (
              <div className="hidden sm:flex items-center gap-2">
                {user?.role === "ADMIN" || user?.role === "SUPER_ADMIN" ? (
                  <Link
                    href="/admin"
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-accent-amber hover:bg-accent-amber/10 transition-colors"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    Admin
                  </Link>
                ) : null}
                <Link
                  href="/studio"
                  className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 transition-colors"
                >
                  <PenLine className="h-3.5 w-3.5" />
                  Write
                </Link>
                <div className="relative group">
                  <button className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-800 border border-surface-700 overflow-hidden">
                    {user?.avatar ? (
                      <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <User className="h-4 w-4 text-surface-400" />
                    )}
                  </button>
                  <div className="absolute right-0 top-full mt-1 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    <div className="rounded-xl border border-surface-700 bg-surface-900 p-1 shadow-xl">
                      <Link
                        href={`/profile/${user?.username}`}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-surface-50"
                      >
                        <User className="h-4 w-4" />
                        Profile
                      </Link>
                      <Link
                        href="/settings"
                        className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-surface-50"
                      >
                        <Settings className="h-4 w-4" />
                        Settings
                      </Link>
                      <button
                        onClick={() => signOut()}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-surface-300 hover:bg-surface-800 hover:text-red-400"
                      >
                        <LogOut className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2">
                <Link
                  href="/auth/signin"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-surface-300 hover:text-surface-50 transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/auth/signup"
                  className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
                >
                  Get started
                </Link>
              </div>
            )}

            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="rounded-lg p-2 text-surface-400 hover:text-surface-50 hover:bg-surface-800 md:hidden"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="border-t border-surface-800 py-4 animate-slide-down md:hidden">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-medium",
                    pathname === link.href
                      ? "text-brand-400 bg-brand-500/10"
                      : "text-surface-400 hover:text-surface-50 hover:bg-surface-800"
                  )}
                >
                  {link.label}
                </Link>
              ))}
              {session ? (
                <>
                  <Link href="/studio" onClick={() => setMobileOpen(false)} className="rounded-lg bg-brand-500 px-3 py-2 text-center text-sm font-medium text-white">
                    Write a story
                  </Link>
                  {(user?.role === "ADMIN" || user?.role === "SUPER_ADMIN") && (
                    <Link href="/admin" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-accent-amber">
                      Admin Panel
                    </Link>
                  )}
                </>
              ) : (
                <>
                  <Link href="/auth/signin" onClick={() => setMobileOpen(false)} className="rounded-lg px-3 py-2 text-sm font-medium text-surface-400 hover:text-surface-50">
                    Sign in
                  </Link>
                  <Link href="/auth/signup" onClick={() => setMobileOpen(false)} className="rounded-lg bg-brand-500 px-3 py-2 text-center text-sm font-medium text-white">
                    Get started
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
