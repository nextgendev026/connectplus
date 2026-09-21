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

    // Whether a service worker was ALREADY controlling this page. On the very
    // first visit there is none; the new worker then calls clients.claim(),
    // which fires controllerchange — reloading on that would refresh every
    // first-time visitor for no reason. Only an update (a controller being
    // replaced) should reload.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false;

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

    // A freshly-activated SW (via SKIP_WAITING) means the page is stale — swap
    // it once, guarded so a controllerchange stampede can't loop the reload.
    const onControllerChange = () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      active = false;
      clearTimeout(bootSync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
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
        <div className="fixed inset-x-0 top-3 z-[80] flex justify-center px-4 animate-slide-down">
          <button
            onClick={refreshNow}
            className="group flex items-center gap-2.5 rounded-2xl border border-brand-500/30 bg-surface-900/90 px-4 py-2.5 text-xs font-semibold text-surface-50 shadow-glow-lg backdrop-blur-xl transition-all hover:border-brand-500/50 hover:bg-surface-900/95 active:scale-[0.97]"
          >
            <span className="relative flex h-6 w-6 items-center justify-center">
              <RefreshCw className="h-3.5 w-3.5 text-brand-400 transition-transform group-hover:rotate-90" style={{ transitionDuration: "600ms" }} />
              <span className="absolute inset-0 rounded-full bg-brand-500/15 animate-ping" style={{ animationDuration: "1.5s" }} />
            </span>
            New version available — tap to refresh
          </button>
        </div>
      )}
      {offline && !updateReady && (
        <div className="fixed inset-x-0 top-3 z-[80] flex justify-center px-4 animate-slide-down">
          <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-surface-900/90 px-4 py-2.5 shadow-glow-lg backdrop-blur-xl">
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/15">
              <WifiOff className="h-3 w-3 text-amber-400" />
            </span>
            <span className="text-xs font-semibold text-amber-300">You&apos;re offline — showing saved content</span>
          </div>
        </div>
      )}
      {backOnline && !offline && !updateReady && (
        <div className="fixed inset-x-0 top-3 z-[80] flex justify-center px-4 animate-slide-down">
          <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-500/30 bg-surface-900/90 px-4 py-2.5 shadow-glow-lg backdrop-blur-xl">
            <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15">
              <Wifi className="h-3 w-3 text-emerald-400" />
            </span>
            <span className="text-xs font-semibold text-emerald-300">Back online</span>
          </div>
        </div>
      )}
    </>
  );
}