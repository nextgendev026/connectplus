"use client";

/**
 * Hardened permission helpers.
 *
 * Browsers silently drop permission prompts that aren't tied to a user
 * gesture, so every request here is designed to be called from a click
 * handler. Callers should always explain WHY the permission is needed first.
 */

export type PermissionOutcome =
  | { status: "granted" }
  | { status: "denied"; message: string }
  | { status: "unsupported"; message: string };

/* ------------------------------------------------------------------ */
/* Geolocation                                                        */
/* ------------------------------------------------------------------ */

export interface GeoResult {
  lat: number;
  lon: number;
  accuracy?: number;
  source: "gps" | "ip" | "default";
}

/** Request GPS access (call from a user gesture). */
export function requestGeolocation(): Promise<PermissionOutcome & { coords?: { lat: number; lon: number; accuracy?: number } }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      resolve({ status: "unsupported", message: "Geolocation is not supported on this device." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          status: "granted",
          coords: {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        });
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? "Location access was denied. You can still see default regional weather."
            : "We couldn't get your location right now. Showing default regional weather.";
        resolve({ status: "denied", message });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  });
}

/** Best-effort IP fallback location (no permission needed). */
export async function fetchIpLocation(): Promise<GeoResult | null> {
  try {
    const res = await fetch("https://ipapi.co/json/", { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { latitude?: number; longitude?: number; city?: string };
    if (typeof data.latitude !== "number" || typeof data.longitude !== "number") return null;
    return { lat: data.latitude, lon: data.longitude, source: "ip" };
  } catch {
    return null;
  }
}

export const DEFAULT_LOCATION: GeoResult = { lat: -1.2864, lon: 36.8172, source: "default" }; // Nairobi

/* ------------------------------------------------------------------ */
/* Notifications (browser push to the notification bar)               */
/* ------------------------------------------------------------------ */

export function notificationPermissionState(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/**
 * Request notification permission. MUST be called from a user gesture (a
 * click). Optionally plays the OS notification sound via the browser API.
 */
export async function requestNotificationPermission(reason: string): Promise<PermissionOutcome> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { status: "unsupported", message: "Notifications are not supported on this device." };
  }
  if (Notification.permission === "granted") return { status: "granted" };
  if (Notification.permission === "denied") {
    return {
      status: "denied",
      message: `Notifications are blocked. Enable them in your browser settings to get ${reason}.`,
    };
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") return { status: "granted" };
    return {
      status: "denied",
      message: `Notification access was declined. You can change this later in browser settings to get ${reason}.`,
    };
  } catch {
    return { status: "denied", message: "We couldn't ask for notification access right now." };
  }
}

/** Show a system notification (if permitted) with an optional sound. */
export function showSystemNotification(title: string, body: string, opts: { sound?: boolean; url?: string; icon?: string } = {}) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  try {
    const n = new Notification(title, {
      body,
      icon: opts.icon ?? "/icon-180.png",
      badge: "/pwa-192.png",
      tag: `connectplus-${Date.now()}`,
      silent: !opts.sound,
    });
    if (opts.url) {
      n.onclick = () => {
        window.focus();
        window.location.href = opts.url!;
      };
    }
  } catch {
    // Some mobile browsers throw when constructing Notification; ignore.
  }
}

/** A short, pleasant chime for in-app notification sounds. */
export function playNotificationSound() {
  if (typeof window === "undefined") return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [880, 1174.66, 1567.98]; // A5, D6, G6 — soft "ding-dong"
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.5);
    });
    // Keep the context from being garbage collected too early.
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    // Audio is best-effort; never throw.
  }
}

/* ------------------------------------------------------------------ */
/* Service worker registration                                        */
/* ------------------------------------------------------------------ */

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Only register in production or when a dev SW exists to avoid stale caches.
  if (process.env.NODE_ENV === "production") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* offline features are progressive enhancement */
      });
    });
  }
}