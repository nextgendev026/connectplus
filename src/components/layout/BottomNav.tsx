"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Download, Home, Radio, PenLine, LayoutGrid, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { promptInstall, useInstallPrompt } from "@/lib/installPrompt";

const ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/radio", label: "Radio", icon: Radio },
  { href: "/studio", label: "Write", icon: PenLine, writing: true },
  { href: "/categories", label: "Browse", icon: LayoutGrid },
  { href: "/auth/signin", label: "Profile", icon: UserRound },
];

function isTabActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/categories") {
    return (
      pathname.startsWith("/categories") ||
      pathname.startsWith("/tags") ||
      pathname.startsWith("/search")
    );
  }
  return pathname.startsWith(href);
}

export default function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { available } = useInstallPrompt();

  const items = ITEMS.map((item) =>
    item.href === "/auth/signin" && session?.user?.username
      ? { ...item, href: `/profile/${session.user.username}` }
      : item
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-surface-800 bg-surface-950/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Mobile navigation"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-1.5">
        {available && (
          <button
            onClick={() => promptInstall()}
            className="relative flex flex-1 flex-col items-center justify-end gap-0.5 rounded-xl px-1 pb-1 text-[10px] font-medium text-brand-400 transition-colors hover:text-brand-300"
            aria-label="Install app"
            title="Install the connectPlus app"
          >
            <span className="flex h-6 items-center justify-center rounded-full px-3">
              <Download className="h-5 w-5" />
            </span>
            Install
            <span className="absolute top-0.5 h-1 w-1 rounded-full bg-brand-400" />
          </button>
        )}
        {items.map(({ href, label, icon: Icon, writing }) => {
          const active = isTabActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-end gap-0.5 rounded-xl px-1 pb-1 text-[10px] font-medium transition-colors",
                active ? "text-brand-400" : "text-surface-500 hover:text-surface-200"
              )}
            >
              <span
                className={cn(
                  "flex h-6 items-center justify-center rounded-full px-3 transition-all duration-200",
                  !writing && active && "bg-brand-500/15"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5",
                    writing && "h-[18px] w-[18px]",
                    active && !writing && "text-brand-400"
                  )}
                />
              </span>
              {/* Animated active dot */}
              <span
                className={cn(
                  "absolute top-0.5 h-1 w-1 rounded-full transition-all duration-200",
                  active && !writing ? "bg-brand-400 scale-100" : "scale-0"
                )}
              />
              {label}
              {/* Write FAB */}
              {writing && (
                <span
                  className={cn(
                    "absolute -top-5 left-1/2 -translate-x-1/2 flex h-11 w-11 items-center justify-center rounded-full shadow-glow transition-all duration-200",
                    active
                      ? "btn-gradient text-white"
                      : "bg-gradient-to-br from-brand-500 to-brand-700 text-white hover:brightness-110"
                  )}
                >
                  <Icon className="h-5 w-5" />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}