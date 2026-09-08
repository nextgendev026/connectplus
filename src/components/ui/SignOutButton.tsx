"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  return (
    <button
      onClick={() => signOut()}
      className={cn(
        "rounded-lg border border-surface-700 bg-surface-800 px-4 py-2 text-sm text-surface-300 hover:text-red-400 transition-colors flex items-center justify-center gap-2",
        className
      )}
      aria-label="Sign out"
    >
      <LogOut className="h-4 w-4" />
    </button>
  );
}