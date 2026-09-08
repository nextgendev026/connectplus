"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { UserPlus, UserCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowButtonProps {
  targetId: string;
  initialFollowing?: boolean;
  followersCount?: number;
  showCount?: boolean;
  className?: string;
}

export function FollowButton({
  targetId,
  initialFollowing = false,
  followersCount = 0,
  showCount = false,
  className,
}: FollowButtonProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(followersCount);
  const [loading, setLoading] = useState(false);

  const isOwnProfile = session?.user?.id === targetId;
  if (isOwnProfile) return null;

  const handleClick = async () => {
    if (!session?.user) {
      const cb = typeof window !== "undefined" ? window.location.pathname : "/";
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(cb)}`);
      return;
    }
    const prev = following;
    setFollowing(!prev);
    setCount((c) => (prev ? c - 1 : c + 1));
    setLoading(true);
    try {
      const res = await fetch("/api/follows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setFollowing(data.following);
      if (typeof data.followersCount === "number") setCount(data.followersCount);
    } catch {
      setFollowing(prev);
      setCount((c) => (prev ? c + 1 : c - 1));
    } finally {
      setLoading(false);
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={handleClick}
        disabled={loading}
        aria-pressed={following}
        className={cn(
          "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-xs font-semibold transition-all duration-300 active:scale-[0.97] sm:h-10 sm:gap-2 sm:px-5 sm:text-sm",
          following
            ? "border border-surface-700 bg-surface-800/80 text-surface-200 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400"
            : "bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-glow hover:from-brand-400 hover:to-brand-500 hover:shadow-glow-lg",
          loading && "cursor-wait opacity-70",
          className
        )}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : following ? (
          <UserCheck className="h-4 w-4" />
        ) : (
          <UserPlus className="h-4 w-4" />
        )}
        {following ? "Following" : "Follow"}
      </button>
      {showCount && count > 0 && (
        <span className="text-sm font-medium text-surface-400">
          {count.toLocaleString()}
        </span>
      )}
    </span>
  );
}
