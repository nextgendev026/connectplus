"use client";

import { useEffect, useState } from "react";
import { Cookie, X } from "lucide-react";

interface Consent {
  essential: boolean;
  analytics: boolean;
  savedAt: string;
}

const CONSENT_KEY = "connectplus-cookie-consent";

export function getCookieConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Consent;
  } catch {
    return null;
  }
}

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    // Wait a beat so the banner doesn't fight the first paint.
    const t = setTimeout(() => {
      if (!getCookieConsent()) setVisible(true);
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  const save = (allowAnalytics: boolean) => {
    const consent: Consent = { essential: true, analytics: allowAnalytics, savedAt: new Date().toISOString() };
    try {
      window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch {
      // private mode — ignore
    }
    setVisible(false);
  };

  if (!visible) return null;

  // On mobile the bottom tab bar is height ~50-64px; dock the consent card just
  // above it so Home/Radio/Write/Browse/Profile stay tappable while it's shown.
  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-[70] p-3 md:bottom-4 md:pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] animate-slide-up">
      <div className="mx-auto max-w-2xl rounded-2xl border border-surface-700 bg-surface-900/95 backdrop-blur-xl shadow-glow-lg p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 border border-brand-500/25">
            <Cookie className="h-4 w-4 text-accent-strong" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-surface-100">We value your privacy</p>
            <p className="mt-1 text-xs leading-relaxed text-surface-400">
              connectPlus uses essential cookies to keep you signed in and working. With your
              permission we also use anonymous analytics cookies to understand how the
              community reads and listens. You can change your choice anytime.
            </p>
            <label className="mt-2.5 flex cursor-pointer items-center gap-2 text-xs text-surface-300">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
                className="h-3.5 w-3.5 rounded accent-brand-500"
              />
              Allow anonymous analytics cookies
            </label>
          </div>
          <button
            onClick={() => save(false)}
            className="shrink-0 rounded-lg p-1.5 text-surface-500 hover:text-surface-200 transition-colors"
            aria-label="Dismiss — essential cookies only"
            title="Dismiss — essential cookies only"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => save(false)}
            className="rounded-lg border border-surface-700 bg-surface-800 px-3.5 py-2 text-xs font-medium text-surface-200 hover:bg-surface-700 transition-colors"
          >
            Essential only
          </button>
          <button
            onClick={() => save(true)}
            className="btn-gradient rounded-lg px-3.5 py-2 text-xs font-semibold text-white"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}