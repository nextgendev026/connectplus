"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { MessageCircle, Link2, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShareMenu } from "./ShareMenu";

interface ArticleActionsProps {
  url: string;
  title: string;
  description?: string;
  image?: string | null;
}

export function ArticleActions({ url, title, description, image }: ArticleActionsProps) {
  const { status } = useSession();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  const absoluteUrl = (() => {
    if (typeof window !== "undefined") return new URL(url, window.location.origin).href;
    return url;
  })();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = absoluteUrl;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const requireAuth = () => {
    if (status !== "authenticated") {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return false;
    }
    return true;
  };

  const openMessenger = () => {
    if (!requireAuth()) return;
    const text = encodeURIComponent(`${title}\n${absoluteUrl}`);
    window.open(
      `https://wa.me/?text=${text}`,
      "_blank",
      "noopener,noreferrer"
    );
  };

  return (
    <>
      <button
        onClick={openMessenger}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 hover:bg-surface-700 hover:text-brand-400 transition-colors"
        aria-label="Share via message"
        title="Share via message"
      >
        <MessageCircle className="h-4 w-4" />
      </button>
      <button
        onClick={copy}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 hover:bg-surface-700 hover:text-surface-50 transition-colors"
        aria-label="Copy link"
        title="Copy link"
      >
        {copied ? <Check className="h-4 w-4 text-brand-400" /> : <Link2 className="h-4 w-4" />}
      </button>
      <ShareMenu
        url={url}
        title={title}
        description={description}
        image={image}
        align="right"
      />
      <button
        onClick={copy}
        className={cn(
          "hidden sm:flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 transition-colors",
          copied ? "text-brand-400" : "hover:bg-surface-700 hover:text-surface-50"
        )}
        aria-label="Copy"
        title="Copy"
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </button>
    </>
  );
}