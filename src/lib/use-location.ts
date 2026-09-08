"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface TrackedLocation {
  lat: number;
  lon: number;
  accuracy?: number;
  source: "gps" | "ip" | "default";
  place?: string | null;
  ts: number;
}

const LOCATION_KEY = "connectplus-location";
export const LOCATION_EVENT = "connectplus:location";

/** Read the last persisted location (if any). */
export function getTrackedLocation(): TrackedLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrackedLocation;
    if (typeof parsed.lat !== "number" || typeof parsed.lon !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a location and notify every listener (weather widget, home hero…). */
export function setTrackedLocation(loc: TrackedLocation): void {
  try {
    window.localStorage.setItem(LOCATION_KEY, JSON.stringify(loc));
  } catch {
    /* private mode — ignore */
  }
  window.dispatchEvent(new CustomEvent<TrackedLocation>(LOCATION_EVENT, { detail: loc }));
}

/**
 * Hardened GPS tracking hook.
 *
 * - Tries the persisted location first (with TTL).
 * - Falls back to IP geolocation (no prompt).
 * - If the user has granted GPS before, silently uses it.
 * - Optional `watch` mode keeps the location fresh while the page is open
 *   (uses watchPosition when permission is already granted, so no extra
 *   prompts — the browser reuses the earlier consent).
 */
export function useTrackedLocation(opts: { watch?: boolean; ttlMs?: number } = {}) {
  const { watch = true, ttlMs = 30 * 60_000 } = opts;
  const [location, setLocation] = useState<TrackedLocation | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "granted" | "fallback" | "denied">("idle");
  const watchIdRef = useRef<number | null>(null);

  const persist = useCallback((loc: TrackedLocation) => {
    setLocation(loc);
    setState(loc.source === "gps" ? "granted" : loc.source === "default" ? "fallback" : "fallback");
    setTrackedLocation(loc);
  }, []);

  const acquire = useCallback(async () => {
    // 1. Persisted + fresh?
    const saved = getTrackedLocation();
    if (saved && Date.now() - saved.ts < ttlMs) {
      persist(saved);
      return;
    }
    // 2. GPS if we can (silently — only triggers a prompt on user gesture,
    //    otherwise the browser returns denied/error and we fall back).
    setState("loading");
    try {
      const permission = navigator.permissions?.query?.({ name: "geolocation" as PermissionName });
      const state = permission ? (await permission).state : "prompt";
      if (state === "granted") {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            persist({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              source: "gps",
              ts: Date.now(),
            }),
          () => fallback(persist),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 5 * 60_000 }
        );
        return;
      }
    } catch {
      /* permissions API unavailable — try direct */
    }
    // 3. IP fallback (no prompt, ~30 min TTL enforced by the server).
    fallback(persist);
  }, [persist, ttlMs]);

  const fallback = useCallback(async (done: (loc: TrackedLocation) => void) => {
    try {
      const res = await fetch("/api/weather?meta=1", { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = (await res.json()) as { coords?: { lat: number; lon: number }; place?: string | null };
        if (data.coords && typeof data.coords.lat === "number" && typeof data.coords.lon === "number") {
          done({
            lat: data.coords.lat,
            lon: data.coords.lon,
            source: "ip",
            place: data.place ?? null,
            ts: Date.now(),
          });
          return;
        }
      }
    } catch {
      /* ignore */
    }
    done({ lat: -1.2864, lon: 36.8172, source: "default", place: "Nairobi", ts: Date.now() });
  }, []);

  // Listen for updates from other components (weather widget GPS grant etc).
  useEffect(() => {
    const onLoc = (e: Event) => {
      const detail = (e as CustomEvent<TrackedLocation>).detail;
      if (detail) {
        setLocation(detail);
        setState(detail.source === "gps" ? "granted" : "fallback");
      }
    };
    window.addEventListener(LOCATION_EVENT, onLoc);
    return () => window.removeEventListener(LOCATION_EVENT, onLoc);
  }, []);

  // Boot: acquire, then optionally watch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await acquire();
      if (cancelled || !watch || typeof navigator === "undefined" || !("geolocation" in navigator)) return;
      try {
        const permission = navigator.permissions?.query?.({ name: "geolocation" as PermissionName });
        const permState = permission ? (await permission).state : "prompt";
        if (permState === "granted") {
          watchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              if (cancelled) return;
              persist({
                lat: pos.coords.latitude,
                lon: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
                source: "gps",
                ts: Date.now(),
              });
            },
            () => {
              /* watch failed — keep last fix */
            },
            { enableHighAccuracy: true, maximumAge: 5 * 60_000 }
          );
        }
      } catch {
        /* no watch */
      }
    })();
    return () => {
      cancelled = true;
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [acquire, watch, persist]);

  return { location, state, refresh: acquire };
}