"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Heart, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { sendFeedback } from "@/lib/feedback";

interface LikeButtonProps {
  postId: string;
  initialCount: number;
}

export function LikeButton({ postId, initialCount }: LikeButtonProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== "authenticated") return;
    let active = true;
    fetch(`/api/likes?postId=${postId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data) {
          setLiked(Boolean(data.liked));
          if (typeof data.likeCount === "number") setCount(data.likeCount);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [postId, status]);

  const handleClick = async () => {
    if (status !== "authenticated" || !session?.user) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setLoading(true);
    const prevLiked = liked;
    const prevCount = count;
    setLiked(!prevLiked);
    setCount(Math.max(0, prevCount + (prevLiked ? -1 : 1)));
    try {
      const res = await fetch("/api/likes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed");
      if (mountedRef.current && typeof data.likeCount === "number") setCount(data.likeCount);
      sendFeedback("like", { postId });
    } catch {
      if (mountedRef.current) {
        setLiked(prevLiked);
        setCount(prevCount);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2 rounded-full px-4 py-2 text-sm transition-colors",
        liked
          ? "bg-red-500/15 text-red-400 ring-1 ring-red-500/30"
          : "bg-surface-800 text-surface-300 hover:bg-surface-700 hover:text-surface-50"
      )}
      aria-label={liked ? "Unlike" : "Like"}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Heart className={cn("h-4 w-4", liked && "fill-current")} />
      )}
      <span>{count}</span>
    </button>
  );
}