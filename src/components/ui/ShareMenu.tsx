"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Share2,
  Link2,
  Check,
  X,
  Mail,
  MessageCircle,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* Brand marks — lucide dropped brand icons, so we ship tiny inline SVGs. */
function XBrand({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookBrand({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function LinkedInBrand({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}


interface ShareMenuProps {
  url: string;
  title: string;
  description?: string;
  image?: string | null;
  hashtags?: string[];
  align?: "left" | "right";
}

interface ShareTarget {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  hover: string;
}

function buildAbsolute(url: string): string {
  if (typeof window === "undefined") return url;
  return new URL(url, window.location.origin).href;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function ShareMenu({
  url,
  title,
  description,
  image,
  hashtags = [],
  align = "right",
}: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nativeCopied, setNativeCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const absoluteUrl = buildAbsolute(url);
  const text = `${title}${hashtags.length ? " " + hashtags.slice(0, 2).map((h) => `#${h.replace(/^#/, "")}`).join(" ") : ""}`;
  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(absoluteUrl);
  const shareDescription = description || "Read this story on connectPlus";

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(absoluteUrl);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = absoluteUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [absoluteUrl]);

  const nativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title,
          text: shareDescription,
          url: absoluteUrl,
        });
        setOpen(false);
      } catch {
        // user cancelled — keep menu open
      }
    } else {
      setNativeCopied(true);
      await copy();
      setTimeout(() => setNativeCopied(false), 2000);
    }
  };

  const targets: ShareTarget[] = [
    {
      label: "Post to X",
      href: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
      icon: XBrand,
      color: "text-surface-100",
      hover: "hover:bg-surface-100 hover:text-black",
    },
    {
      label: "Share on Facebook",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
      icon: FacebookBrand,
      color: "text-[#1877F2]",
      hover: "hover:bg-[#1877F2]/15",
    },
    {
      label: "Share on LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
      icon: LinkedInBrand,
      color: "text-[#0A66C2]",
      hover: "hover:bg-[#0A66C2]/15",
    },
    {
      label: "Share on WhatsApp",
      href: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
      icon: MessageCircle,
      color: "text-[#25D366]",
      hover: "hover:bg-[#25D366]/15",
    },
    {
      label: "Share on Telegram",
      href: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
      icon: Send,
      color: "text-[#229ED9]",
      hover: "hover:bg-[#229ED9]/15",
    },
    {
      label: "Share by email",
      href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${shareDescription}\n\n${absoluteUrl}`)}`,
      icon: Mail,
      color: "text-accent-amber",
      hover: "hover:bg-accent-amber/15",
    },
  ];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-800 text-surface-400 transition-all hover:bg-surface-700 hover:text-brand-400 hover:shadow-glow"
        aria-label="Share this story"
        title="Share"
        aria-expanded={open}
      >
        <Share2 className="h-4 w-4" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute bottom-full z-50 mb-2 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl animate-scale-in",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {/* SEO preview card — the exact components crawlers read */}
          <div className="border-b border-surface-800 bg-surface-900/70 p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
              <Link2 className="h-3 w-3 text-brand-400" />
              Link preview
              <span className="ml-auto rounded-full bg-surface-800 px-2 py-0.5 normal-case tracking-normal text-surface-400">
                {domainOf(absoluteUrl)}
              </span>
            </div>
            <div className="mt-3 flex gap-3">
              {image ? (
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-surface-700">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600/40 via-brand-500/20 to-accent-coral/30 text-2xl">
                  🦁
                </div>
              )}
              <div className="min-w-0">
                <p className="line-clamp-2 text-xs font-semibold leading-snug text-surface-50">
                  {title}
                </p>
                <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-surface-400">
                  {shareDescription}
                </p>
              </div>
            </div>
          </div>

          {/* Share targets */}
          <div className="grid grid-cols-2 gap-1 p-2">
            {targets.map((t) => (
              <a
                key={t.label}
                href={t.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setTimeout(() => setOpen(false), 150)}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium text-surface-300 transition-colors",
                  t.hover
                )}
              >
                <t.icon className={cn("h-4 w-4", t.color)} />
                {t.label}
              </a>
            ))}
            <button
              onClick={copy}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium text-surface-300 transition-colors hover:bg-brand-500/15"
            >
              {copied ? (
                <Check className="h-4 w-4 text-brand-400" />
              ) : (
                <Link2 className="h-4 w-4 text-brand-400" />
              )}
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>

          {/* Native share / close */}
          <div className="flex items-center gap-2 border-t border-surface-800 bg-surface-900/60 px-3 py-2">
            <button
              onClick={nativeShare}
              className="btn-gradient flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-white"
            >
              {nativeCopied ? (
                <>
                  <Check className="h-3.5 w-3.5" /> Link copied
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5" /> More options
                </>
              )}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
              aria-label="Close share menu"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}