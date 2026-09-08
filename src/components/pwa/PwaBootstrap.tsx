"use client";

import { useEffect, useRef, useState } from "react";
import { WifiOff, RefreshCw, Wifi } from "lucide-react";

/**
 * PWA bootstrap: registers the service worker once, watches for a new version
 * (offering a one-tap refresh), and surfaces online/offline state so users
 * always know whether they're seeing live or saved content.
 */
export function PwaBootstrap() {
  const [updateReady, setUpdateReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const swRef = useRef<ServiceWorkerRegistration | null>(null);
  const backOnlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // navigator.onLine can flap at boot (some webviews report offline for the
    // first few hundred ms), so debounce the offline signal and re-sync after
    // mount instead of trusting the initial snapshot.
    const bootSync = setTimeout(() => {
      if (navigator.onLine) setOffline(false);
    }, 1500);

    const onOnline = () => {
      setOffline(false);
      setBackOnline(true);
      if (backOnlineTimer.current) clearTimeout(backOnlineTimer.current);
      backOnlineTimer.current = setTimeout(() => setBackOnline(false), 2500);
    };
    const onOffline = () => {
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
      offlineTimer.current = setTimeout(() => setOffline(true), 1200);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    let active = true;

    const register = () => {
      if (!active) return;
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          swRef.current = reg;
          reg.addEventListener("updatefound", () => {
            const next = reg.installing;
            if (!next) return;
            next.addEventListener("statechange", () => {
              if (next.state === "installed" && navigator.serviceWorker.controller) {
                setUpdateReady(true);
              }
            });
          });
        })
        .catch(() => {
          /* offline features are progressive enhancement */
        });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    // A freshly-activated SW (via SKIP_WAITING) means the page is stale.
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });

    return () => {
      active = false;
      clearTimeout(bootSync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (backOnlineTimer.current) clearTimeout(backOnlineTimer.current);
      if (offlineTimer.current) clearTimeout(offlineTimer.current);
    };
  }, []);

  const refreshNow = () => {
    if (swRef.current?.waiting) {
      swRef.current.waiting.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  };

  return (
    <>
      {updateReady && (
        <div className="fixed inset-x-0 top-3 z-[80] flex justify-center px-4">
          <button
            onClick={refreshNow}
            className="flex items-center gap-2 rounded-full border border-brand-500/40 bg-surface-900/95 px-4 py-2 text-xs font-semibold text-surface-50 shadow-glow backdrop-blur-xl transition-transform active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5 text-brand-400" />
            New version available — tap to refresh
          </button>
        </div>
      )}
      {offline && !updateReady && (
        <div className="fixed inset-x-0 top-3 z-[80] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-surface-900/95 px-4 py-2 text-xs font-semibold text-amber-300 shadow-glow backdrop-blur-xl">
            <WifiOff className="h-3.5 w-3.5" />
            You&apos;re offline — showing saved content
          </div>
        </div>
      )}
      {backOnline && !offline && !updateReady && (
        <div className="fixed inset-x-0 top-3 z-[80] flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/40 bg-surface-900/95 px-4 py-2 text-xs font-semibold text-emerald-300 shadow-glow backdrop-blur-xl">
            <Wifi className="h-3.5 w-3.5" />
            Back online
          </div>
        </div>
      )}
    </>
  );
}