"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Share2,
  Link2,
  Check,
  X,
  Mail,
  MessageCircle,
  Send,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BRAND_NAME } from "@/lib/brand";
import {
  createShareTargets,
  shareImage,
  withAttribution,
  type ShareTargetId,
} from "@/lib/share";

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
  /** Which surface invited the share — becomes `utm_campaign`. */
  campaign?: string;
  /** The specific object being shared — becomes `utm_content`. */
  content?: string;
  align?: "left" | "right";
  /**
   * The button's accessible name. The default assumes a story, which is wrong on
   * a sports pick or a board: a screen reader announcing "Share this story" on a
   * fixture card tells the reader nothing about what they are sharing.
   */
  ariaLabel?: string;
  /** Tighter button for dense rows — card headers and toolbars. */
  compact?: boolean;
}

/** Per-channel presentation. The behaviour lives in lib/share, not here. */
const TARGET_STYLE: Record<ShareTargetId, { icon: React.ComponentType<{ className?: string }>; color: string; hover: string }> = {
  x: { icon: XBrand, color: "text-surface-100", hover: "hover:bg-surface-100 hover:text-black" },
  facebook: { icon: FacebookBrand, color: "text-[#1877F2]", hover: "hover:bg-[#1877F2]/15" },
  linkedin: { icon: LinkedInBrand, color: "text-[#0A66C2]", hover: "hover:bg-[#0A66C2]/15" },
  whatsapp: { icon: MessageCircle, color: "text-[#25D366]", hover: "hover:bg-[#25D366]/15" },
  telegram: { icon: Send, color: "text-[#229ED9]", hover: "hover:bg-[#229ED9]/15" },
  email: { icon: Mail, color: "text-accent-amber", hover: "hover:bg-accent-amber/15" },
  copy: { icon: Link2, color: "text-brand-400", hover: "hover:bg-brand-500/15" },
};

/** True on phones — the menu becomes a bottom sheet there instead of a popover. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
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
  campaign,
  content,
  align = "right",
  ariaLabel = "Share this story",
  compact = false,
}: ShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nativeCopied, setNativeCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // `isMobile` is false until the media query is read on the client, so the
  // portal below can never run during SSR — no extra mounted flag needed.
  const isMobile = useIsMobile();

  /**
   * Every channel gets its own attributed URL and its own fitted message.
   *
   * This is the whole point of routing sharing through lib/share: the menu shows
   * one list, but what a channel receives is per-channel — a message short
   * enough for X, the link in the same field for WhatsApp, and a `utm_source`
   * that names the app it travelled through so shared traffic is measurable
   * instead of landing in "direct".
   */
  const shares = useMemo(
    () => createShareTargets({ url, title, description, hashtags, campaign, content }),
    [url, title, description, hashtags, campaign, content]
  );

  const previewImage = useMemo(() => shareImage(image), [image]);
  const previewUrl = useMemo(() => shares[0]?.url ?? url, [shares, url]);
  const previewMessage = useMemo(() => shares.find((s) => s.target.id === "copy")?.message ?? title, [shares, title]);
  const copyShare = shares.find((s) => s.target.id === "copy");
  const channelShares = shares.filter((s) => s.target.id !== "copy");

  // Close on outside click / Escape (desktop popover only; the sheet has its own scrim).
  useEffect(() => {
    if (!open || isMobile) return;
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
  }, [open, isMobile]);

  // Escape + body scroll lock while the mobile sheet is up.
  useEffect(() => {
    if (!open || !isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile]);

  const copy = useCallback(async () => {
    const value = copyShare?.url ?? url;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Older/insecure contexts have no async clipboard. A textarea selection is
      // ugly and it works, which is what matters on the device that needs it.
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [copyShare?.url, url]);

  const nativeShare = async () => {
    const nativeUrl = withAttribution(url, { source: "share_sheet", campaign, content });
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        // The OS sheet is where a reader on a phone actually sends things, so it
        // gets the composed message too — not just a bare link.
        await navigator.share({ title, text: previewMessage, url: nativeUrl });
        setOpen(false);
      } catch {
        // user cancelled — keep the menu open
      }
    } else {
      setNativeCopied(true);
      await copy();
      setTimeout(() => setNativeCopied(false), 2000);
    }
  };

  /**
   * Social endpoints live on other origins and several browsers drop a plain
   * `target=_blank` when the menu unmounts in the same tick. Opening an
   * explicitly sized popup is what reliably lands the composer, with a direct
   * navigation fallback when the popup is blocked.
   */
  const go = useCallback((href: string, event: React.MouseEvent) => {
    event.preventDefault();
    const win = window.open(href, "_blank", "noopener,noreferrer,width=640,height=700");
    if (!win) window.location.href = href;
    setTimeout(() => setOpen(false), 150);
  }, []);

  const panelBody = (
    <>
      {/* The card a crawler renders — image, title, description, domain. */}
      <div className="border-b border-surface-800 bg-surface-900/70 p-4">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-surface-500">
          <Link2 className="h-3 w-3 text-brand-400" />
          Link preview
          <span className="ml-auto rounded-full bg-surface-800 px-2 py-0.5 normal-case tracking-normal text-surface-400">
            {domainOf(previewUrl) || BRAND_NAME}
          </span>
        </div>
        <div className="mt-3 flex gap-3">
          <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-surface-700 bg-surface-800">
            {/* The generated 1200×630 card renders here at 96×64 — the same
                picture the recipient sees, instead of a placeholder emoji. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
          <div className="min-w-0">
            <p className="line-clamp-2 text-xs font-semibold leading-snug text-surface-50">{title}</p>
            <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-surface-400">
              {description || previewMessage}
            </p>
          </div>
        </div>
      </div>

      {/* Share targets */}
      <div className="grid grid-cols-2 gap-1 p-2">
        {channelShares.map((share) => {
          const style = TARGET_STYLE[share.target.id];
          return (
            <a
              key={share.target.id}
              href={share.href ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => (share.href ? go(share.href, e) : e.preventDefault())}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium text-surface-300 transition-colors",
                style.hover
              )}
            >
              <style.icon className={cn("h-4 w-4", style.color)} />
              {share.target.label}
            </a>
          );
        })}
        <button
          onClick={copy}
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-medium text-surface-300 transition-colors hover:bg-brand-500/15"
        >
          {copied ? <Check className="h-4 w-4 text-brand-400" /> : <Link2 className="h-4 w-4 text-brand-400" />}
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
        {!isMobile ? (
          <button
            onClick={() => setOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-800 hover:text-surface-50"
            aria-label="Close share menu"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/*
        Says out loud what the recipient's card will show and that each channel
        gets its own attributed link — an operator reading a share menu should not
        have to guess whether shared traffic is measurable.
      */}
      <p className="flex items-start gap-1.5 border-t border-surface-800/70 px-4 py-2 text-[10px] leading-relaxed text-surface-500">
        <Target className="mt-px h-3 w-3 shrink-0 text-brand-400" />
        Every link carries a campaign tag, so you can see which platform brought the reader back.
      </p>
    </>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full bg-surface-800 text-surface-400 transition-all hover:bg-surface-700 hover:text-brand-400 hover:shadow-glow",
          compact ? "h-7 w-7" : "h-9 w-9"
        )}
        aria-label={ariaLabel}
        title="Share"
        aria-expanded={open}
      >
        <Share2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      </button>

      {open && !isMobile ? (
        <div
          className={cn(
            "absolute bottom-full z-50 mb-2 w-[min(92vw,22rem)] overflow-hidden rounded-2xl border border-surface-700 bg-surface-900 shadow-2xl animate-scale-in",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {panelBody}
        </div>
      ) : null}

      {open && isMobile
        ? createPortal(
            <div className="fixed inset-0 z-[120]">
              <button
                aria-label="Close share menu"
                onClick={() => setOpen(false)}
                className="absolute inset-0 h-full w-full bg-black/60 backdrop-blur-[2px]"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label={ariaLabel}
                className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto overscroll-contain rounded-t-3xl border-t border-surface-700 bg-surface-900 pb-[max(env(safe-area-inset-bottom),0.5rem)] shadow-2xl animate-slide-up"
              >
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-surface-800 bg-surface-900/95 px-4 py-3 backdrop-blur">
                  <div className="flex items-center gap-2">
                    <span className="mx-auto absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-surface-700" />
                    <p className="text-sm font-semibold text-surface-100">{ariaLabel}</p>
                  </div>
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-surface-400 transition-colors hover:bg-surface-800 hover:text-surface-50"
                    aria-label="Close share menu"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {panelBody}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
