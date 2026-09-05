"use client";

import { useEffect, useState, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Bookmark, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface BookmarkButtonProps {
  postId: string;
  /** Fetch current saved state on mount (uses one GET request each). */
  fetchState?: boolean;
  className?: string;
  variant?: "icon" | "pill";
}

export function BookmarkButton({
  postId,
  fetchState = false,
  className,
  variant = "icon",
}: BookmarkButtonProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!fetchState || status !== "authenticated") return;
    let active = true;
    fetch(`/api/bookmarks/${postId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data && typeof data.bookmarked === "boolean") {
          setSaved(data.bookmarked);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [postId, fetchState, status]);

  const handleClick = async () => {
    if (status !== "authenticated" || !session?.user) {
      const cb = typeof window !== "undefined" ? window.location.pathname : "/";
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(cb)}`);
      return;
    }
    setLoading(true);
    const prev = saved;
    setSaved(!prev);
    try {
      const res = await fetch(`/api/bookmarks/${postId}`, {
        method: prev ? "DELETE" : "POST",
      });
      if (!res.ok) throw new Error(await res.text());
    } catch {
      if (mountedRef.current) setSaved(prev);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  if (variant === "pill") {
    return (
      <button
        onClick={handleClick}
        className={cn(
          "flex items-center gap-2 rounded-full px-4 py-2 text-sm text-surface-300 transition-colors",
          saved
            ? "bg-brand-500/20 text-brand-400 ring-1 ring-brand-500/40"
            : "bg-surface-800 hover:bg-surface-700 hover:text-surface-50",
          className
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bookmark className={cn("h-4 w-4", saved && "fill-current")} />
        )}
        {saved ? "Saved" : "Save"}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center justify-center rounded-full bg-surface-900/70 p-2.5 text-surface-300 backdrop-blur-sm transition-all duration-300 hover:bg-brand-500/20 hover:text-brand-400",
        saved && "bg-brand-500/25 text-brand-400 ring-1 ring-brand-500/40",
        className
      )}
      aria-label={saved ? "Remove bookmark" : "Bookmark post"}
    >
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Bookmark className={cn("h-5 w-5", saved && "fill-current")} />
      )}
    </button>
  );
}