"use client";

import { useState } from "react";
import { MapPin, LocateFixed, Navigation } from "lucide-react";
import { useTrackedLocation, getTrackedLocation } from "@/lib/use-location";
import { cn } from "@/lib/utils";

/**
 * "Listening from" chip for the home hero. Reads the shared GPS/IP location
 * (persisted by the weather widget or the location hook) and updates in
 * realtime when the user grants location access.
 */
export function ListeningLocation() {
  const { location, state, refresh } = useTrackedLocation({ watch: true });
  const [busy, setBusy] = useState(false);

  const place = location?.place;
  const coords = location ? `${location.lat.toFixed(2)}°, ${location.lon.toFixed(2)}°` : null;
  const isGps = location?.source === "gps";

  const handleLocate = async () => {
    setBusy(true);
    try {
      // If we already have a fix, surface it; otherwise prompt via geolocation.
      if (getTrackedLocation()) {
        await refresh();
      } else {
        const res = await requestGpsOnce();
        if (res) setTrackedFromGps(res);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handleLocate}
      disabled={busy}
      title={isGps ? "Live GPS fix — tap to refresh" : "Tap to enable GPS for accurate local weather"}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-all",
        isGps
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25"
          : "border-white/25 bg-black/35 text-white/85 hover:border-brand-400/50 hover:bg-black/55"
      )}
    >
      {busy ? (
        <LocateFixed className="h-3.5 w-3.5 animate-spin" />
      ) : isGps ? (
        <Navigation className="h-3.5 w-3.5 text-emerald-300" />
      ) : (
        <MapPin className="h-3.5 w-3.5 text-brand-400" />
      )}
      <span className="flex flex-col items-start leading-tight">
        <span className="text-[9px] uppercase tracking-widest opacity-70">
          {isGps ? "Listening from" : "Your location"}
        </span>
        <span className="font-semibold">
          {place ?? (isGps ? coords : "Enable GPS")}
        </span>
      </span>
      {isGps && coords && (
        <span className="hidden sm:inline-flex text-[9px] text-emerald-200/70 border-l border-emerald-400/30 pl-2 ml-0.5">
          {coords}
        </span>
      )}
    </button>
  );
}

/* ---- helpers: one-shot GPS grant from a user gesture ---- */

function requestGpsOnce(): Promise<{ lat: number; lon: number; accuracy?: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  });
}

function setTrackedFromGps(coords: { lat: number; lon: number; accuracy?: number }) {
  // Import lazily to avoid a circular import — this module and use-location
  // both talk to localStorage/events, so just use the same key directly.
  const evt = new CustomEvent("connectplus:location", {
    detail: { ...coords, source: "gps", ts: Date.now(), place: null },
  });
  try {
    window.localStorage.setItem(
      "connectplus-location",
      JSON.stringify({ ...coords, source: "gps", ts: Date.now(), place: null })
    );
  } catch {
    /* ignore */
  }
  window.dispatchEvent(evt);
}