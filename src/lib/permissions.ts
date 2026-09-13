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
/* Service worker + push subscription                                 */
/* ------------------------------------------------------------------ */

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  // Register in both production and development for push notifications
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline features are progressive enhancement */
    });
  });
}

/**
 * The VAPID public key, however it was named in the environment.
 *
 * Next only inlines `NEXT_PUBLIC_*` into a client bundle, so the canonical name
 * is `NEXT_PUBLIC_VAPID_KEY`. The other spellings are accepted because the
 * server-side sender and the platform dashboards use them, and a key that is
 * present under one name but read under another is the classic reason "push is
 * configured" while no device is ever subscribed.
 */
function vapidPublicKey(): string {
  return (
    process.env.NEXT_PUBLIC_VAPID_KEY ??
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ??
    process.env.VAPID_PUBLIC_KEY ??
    ""
  );
}

/** True when this browser can hold a push subscription at all. */
export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * True when background push is actually deliverable: the device supports it AND
 * this deployment has a VAPID public key. Callers use it to explain the real
 * capability instead of rendering a button that silently does nothing.
 */
export function webPushConfigured(): boolean {
  return pushSupported() && vapidPublicKey().length > 0;
}

/**
 * Subscribe to push notifications via the service worker.
 * Returns the subscription object or null on failure.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;

  try {
    const reg = await navigator.serviceWorker.ready;
    // Check for existing subscription
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      // Already subscribed: re-post so the server has the current endpoint even
      // after it pruned the row (browsers rotate push endpoints silently).
      await postSubscription(sub).catch(() => {});
      return sub;
    }

    const vapidKey = vapidPublicKey();
    if (!vapidKey) {
      console.warn(
        "No VAPID public key configured — background push is unavailable. Set NEXT_PUBLIC_VAPID_KEY."
      );
      return null;
    }

    const rawKey = urlBase6ToUint8Array(vapidKey);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: rawKey as BufferSource,
    });

    await postSubscription(sub);
    return sub;
  } catch (err) {
    console.error("Push subscription failed:", err);
    return null;
  }
}

/**
 * Unsubscribe from push notifications.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // No local subscription, but the server may still hold a stale row from a
      // previous browser profile — clear it so sends stop.
      await fetch("/api/notifications/push", { method: "DELETE" }).catch(() => {});
      return true;
    }

    // Identify this exact device so turning alerts off on a phone does not
    // silence the reader's desktop too.
    const endpoint = encodeURIComponent(sub.endpoint);
    await sub.unsubscribe();
    await fetch(`/api/notifications/push?endpoint=${endpoint}`, { method: "DELETE" }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

function urlBase6ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/** 
 * Send one subscription to the server.
 *
 * Guarded, because an eager fetch with no subscription keys would post
 * `undefined` for p256dh/auth and the API would reject the whole request —
 * leaving the device believing it had subscribed.
 */
async function postSubscription(sub: PushSubscription): Promise<void> {
  const p256dh = sub.getKey?.("p256dh");
  const auth = sub.getKey?.("auth");
  if (!p256dh || !auth) return;
  await fetch("/api/notifications/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: {
        p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
        auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
      },
    }),
  });
}