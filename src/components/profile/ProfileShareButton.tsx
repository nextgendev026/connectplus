"use client";

import { useState } from "react";
import { Share2, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProfileShareButton({
  username,
  displayName,
  className,
}: {
  username: string;
  displayName: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "copied">("idle");

  async function share() {
    const url = `${window.location.origin}/profile/${username}`;
    setState("loading");
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: displayName, url });
        setState("idle");
        return;
      }
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      // User dismissed the share sheet or clipboard is unavailable — fall back
      // to prompting a manual copy.
      try {
        await navigator.clipboard.writeText(url);
        setState("copied");
        setTimeout(() => setState("idle"), 2000);
      } catch {
        setState("idle");
      }
    }
  }

  return (
    <button
      onClick={share}
      aria-label="Share profile"
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 text-xs font-medium text-white/90 backdrop-blur-md transition-all hover:bg-black/50 hover:text-white",
        className
      )}
    >
      {state === "loading" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "copied" ? (
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      ) : (
        <Share2 className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">
        {state === "copied" ? "Copied!" : "Share"}
      </span>
    </button>
  );
}
