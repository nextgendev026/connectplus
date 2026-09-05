"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { Home, Radio, PenLine, LayoutGrid, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

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
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 py-1.5">
        {items.map(({ href, label, icon: Icon, writing }) => {
          const active = isTabActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-1 flex-col items-center justify-end gap-0.5 rounded-xl px-1 py-1 text-[10px] font-medium transition-colors",
                active ? "text-brand-400" : "text-surface-500 hover:text-surface-200"
              )}
            >
              <span
                className={cn(
                  "flex h-6 items-center justify-center",
                  writing && "h-10 w-10 -mt-6 -mb-2 rounded-full shadow-glow transition-colors",
                  writing && (active ? "bg-brand-400 text-surface-950" : "bg-brand-500 text-white")
                )}
              >
                <Icon className={cn("h-5 w-5", writing && "h-[18px] w-[18px]")} />
              </span>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}