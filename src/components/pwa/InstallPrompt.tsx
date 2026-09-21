"use client";

import { Check, Download, X } from "lucide-react";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";
import {
  dismissInstall,
  getInstallState,
  initInstallListeners,
  promptInstall,
  subscribeInstall,
} from "@/lib/installPrompt";
import { useEffect, useRef, useState } from "react";

/**
 * PWA install banner. Android/Chrome: captures `beforeinstallprompt` and
 * triggers the native install dialog. iOS Safari: shows instructions to add to
 * the home screen. The mobile bottom-nav install cap shares the same store, so
 * the banner and the cap always agree about installability. Auto-hides when the
 * app is already running standalone or the user has dismissed the prompt.
 */
export function InstallPrompt() {
  const [, setTick] = useState(0);
  const [autoIos, setAutoIos] = useState(false);
  const iosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initInstallListeners();
    return subscribeInstall(() => setTick((n) => n + 1));
  }, []);

  const st = getInstallState();

  // iOS has no beforeinstallprompt — nudge once, a few seconds after first
  // load, unless the app is already installed/dismissed.
  useEffect(() => {
    if (!st.isIOS || st.standalone || st.dismissed) return;
    iosTimer.current = setTimeout(() => setAutoIos(true), 4000);
    return () => {
      if (iosTimer.current) clearTimeout(iosTimer.current);
      iosTimer.current = null;
    };
  }, [st.isIOS, st.standalone, st.dismissed]);

  if (st.installed) {
    return (
      <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-[calc(100%-2rem)] max-w-sm md:bottom-6 animate-slide-up">
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-surface-900/90 p-3.5 shadow-glow-lg backdrop-blur-xl">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
            <Check className="h-5 w-5 text-positive-strong" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-surface-50">connectPlus installed</p>
            <p className="truncate text-[11px] text-surface-400">
              Launch it anytime from your home screen.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const bannerVisible =
    !st.standalone && !st.dismissed && (Boolean(st.deferred) || Boolean(st.iosHint) || autoIos);

  if (!bannerVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-[calc(100%-2rem)] max-w-sm md:bottom-6 animate-slide-up">
      <div className="relative overflow-hidden rounded-2xl border border-brand-500/25 bg-surface-900/90 p-3.5 shadow-glow-lg backdrop-blur-xl">
        {/* Subtle gradient background accent */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-500/8 via-transparent to-accent-amber/5 pointer-events-none" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-brand-500/15 to-accent-amber/10 ring-1 ring-brand-500/20">
            <ConnectPlusMark className="h-8 w-8" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-surface-50">
              {st.isIOS ? "Add to Home Screen" : "Install connectPlus"}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-surface-400">
              {st.isIOS
                ? "Tap Share, then Add to Home Screen for the full experience."
                : "Get the full app — stories, radio, live scores & more."}
            </p>
          </div>
          {st.isIOS ? (
            <button
              onClick={() => dismissInstall()}
              className="shrink-0 rounded-lg px-3 py-2 text-xs font-medium text-brand-400 hover:text-brand-300 transition-colors"
            >
              Got it
            </button>
          ) : (
            <button
              onClick={() => promptInstall()}
              className="group relative shrink-0 overflow-hidden rounded-xl bg-gradient-to-r from-brand-500 to-accent-amber px-4 py-2 text-xs font-bold text-white shadow-md transition-all hover:shadow-glow active:scale-[0.97]"
            >
              <span className="relative z-10 flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Install
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-brand-400 to-accent-amber opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )}
          <button
            onClick={() => dismissInstall()}
            className="shrink-0 rounded-lg p-1.5 text-surface-500 hover:text-surface-200 transition-colors"
            aria-label="Dismiss install prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
