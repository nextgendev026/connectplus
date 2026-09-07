"use client";

import { useEffect, useState } from "react";
import { X, Download, Plus } from "lucide-react";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * PWA install banner. Android/Chrome: captures `beforeinstallprompt` and
 * triggers the native install dialog. iOS Safari: shows instructions to add to
 * the home screen. Auto-hides when the app is already running standalone.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS Safari exposes navigator.standalone
      window.navigator.standalone === true
    ) {
      return;
    }
    const dismissedBefore = localStorage.getItem("connectplus-install-dismissed");
    if (dismissedBefore) return;

    const isSafariIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      // @ts-expect-error non-standard
      !window.MSStream;
    setIsIOS(isSafariIOS);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", () => setVisible(false));

    // iOS has no beforeinstallprompt — nudge after a short delay instead.
    let t: ReturnType<typeof setTimeout> | undefined;
    if (isSafariIOS) {
      t = setTimeout(() => setVisible(true), 4000);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", () => setVisible(false));
      if (t) clearTimeout(t);
    };
  }, []);

  const install = async () => {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice;
      setDeferred(null);
      setVisible(false);
      return;
    }
    // iOS fallback: point them at the share sheet.
    if (isIOS) {
      setDismissed(true);
      localStorage.setItem("connectplus-install-dismissed", "1");
    }
  };

  if (!visible || dismissed) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-50 mx-auto w-[calc(100%-2rem)] max-w-sm md:bottom-6">
      <div className="glass-card flex items-center gap-3 border border-brand-500/30 bg-surface-900/90 p-3 shadow-glow-lg">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl">
          <ConnectPlusMark className="h-full w-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-surface-50">Install connectPlus</p>
          <p className="truncate text-[11px] text-surface-400">
            {isIOS
              ? "Tap Share, then “Add to Home Screen”."
              : "Get the full app experience — stories, radio & more."}
          </p>
        </div>
        <button
          onClick={install}
          className="btn-gradient flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white"
        >
          {isIOS ? <Plus className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
          {isIOS ? "How?" : "Install"}
        </button>
        <button
          onClick={() => {
            setDismissed(true);
            localStorage.setItem("connectplus-install-dismissed", "1");
          }}
          className="shrink-0 rounded-lg p-1.5 text-surface-500 hover:text-surface-200"
          aria-label="Dismiss install prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}