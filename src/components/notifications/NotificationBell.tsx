"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, UserPlus, MessageSquare, Reply, ShieldCheck, BellRing, Trophy } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  announceNotification,
  notificationPermissionState,
  playNotificationSound,
  requestNotificationPermission,
  showSystemNotification,
  subscribeToPush,
  unlockNotificationSounds,
  unsubscribeFromPush,
  webPushConfigured,
} from "@/lib/permissions";
import { describeNotification } from "@/lib/notification-display";
import { getCookieConsent } from "@/components/pwa/CookieConsent";

interface Actor {
  id: string;
  name: string | null;
  username: string;
  avatar: string | null;
}

interface PostRef {
  id: string;
  slug: string;
  title: string;
}

interface Notification {
  id: string;
  type: string;
  title: string | null;
  message: string | null;
  read: boolean;
  createdAt: string;
  actor: Actor | null;
  post: PostRef | null;
}

const TYPE_ICONS: Record<string, typeof Bell> = {
  FOLLOW: UserPlus,
  COMMENT: MessageSquare,
  REPLY: Reply,
  MODERATION_APPROVED: ShieldCheck,
};

/** Sports alerts share one glyph: the notification is about a fixture. */
function iconFor(type: string): typeof Bell {
  if (type?.toUpperCase().startsWith("SPORTS_")) return Trophy;
  return TYPE_ICONS[type] ?? Bell;
}

export function NotificationBell() {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const [enableMsg, setEnableMsg] = useState<string | null>(null);
  const [cookieConsent, setCookieConsent] = useState<boolean>(false);
  const permState = notificationPermissionState();
  // Once the user has made a cookie/privacy choice, stop nagging for
  // notification permission — they've already opted in/out of tracking.
  const canSuggest = !cookieConsent && permState !== "granted" && permState !== "unsupported";

  useEffect(() => {
    // Reflect consent as soon as it's stored (cookie banner accept/dismiss).
    const sync = () => setCookieConsent(!!getCookieConsent());
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    /*
     * Unlock the notification voices on the first real interaction.
     *
     * Browsers will not start an audio context outside a gesture, so without
     * this the first chime after a page load is dropped and only the second one
     * is heard — which reads to a reader as "the sound is broken".
     * `{ once: true }` because one gesture is all it takes.
     */
    const unlock = () => {
      unlockNotificationSounds();
    };
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=10");
      if (!res.ok) return;
      const data = await res.json();
      const next = (data.notifications ?? []) as Notification[];
      // First load just seeds the baseline; later loads detect new arrivals.
      if (prevIdsRef.current.size > 0) {
        const fresh = next.filter((n) => !n.read && !prevIdsRef.current.has(n.id));
        const top = fresh[0];
        if (top) {
          // The sound, the text and the destination all come from one shared
          // description, so the bell and the notifications page cannot tell the
          // reader two different stories about the same event.
          const view = describeNotification(top);
          const { sound } = announceNotification(view.kind);
          showSystemNotification(
            top.actor?.name ? `${top.actor.name} · connectPlus` : view.headline,
            view.body,
            {
              // Only one channel makes noise: if the in-app chime played, the OS
              // banner stays silent rather than doubling the alert.
              sound: !sound,
              url: view.href,
              kind: view.kind,
            }
          );
        }
      }
      prevIdsRef.current = new Set(next.map((n) => n.id));
      setItems(next);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/session-change: the sync setState is only an idempotent loading flag
    if (session?.user) load();
  }, [session?.user, load]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next) load();
      return next;
    });
  }, [load]);

  const [pushState, setPushState] = useState<"unknown" | "subscribed" | "denied" | "unsupported">("unknown");
  const [testSent, setTestSent] = useState(false);
  const pushAvailable = webPushConfigured();

  useEffect(() => {
    // Ask the server whether this reader already has a live push subscription,
    // so the bell can show "Alerts on" instead of offering the same button
    // forever. Unauthenticated readers just get the default.
    if (!session?.user) return;
    let active = true;
    fetch("/api/notifications/push", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d) setPushState(d.subscribed ? "subscribed" : "denied");
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [session?.user]);

  const handleItemClick = useCallback(
    async (notif: Notification) => {
      setOpen(false);
      if (notif.read) return;
      setUnreadCount((prev) => Math.max(0, prev - 1));
      setItems((prev) =>
        prev.map((n) => (n.id === notif.id ? { ...n, read: true } : n))
      );
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notif.id }),
      }).catch(() => {});
    },
    []
  );

  const markAllRead = useCallback(async () => {
    setUnreadCount(0);
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => {});
  }, []);

  const enableNotifications = useCallback(async () => {
    setEnableMsg(null);
    const res = await requestNotificationPermission(
      "alerts when someone follows you, replies to your stories, or one of your followed teams plays"
    );
    if (res.status !== "granted") {
      setEnableMsg(res.message);
      return;
    }

    // Permission alone only powers in-tab alerts. Register the service worker
    // and a real push subscription so an alert can arrive with the app closed —
    // that is the difference between "I saw it when I opened the site" and an
    // actual notification. Without a VAPID key only the first is possible, and
    // the copy below says so rather than pretending otherwise.
    const sub = await subscribeToPush();
    if (sub) {
      setPushState("subscribed");
      return;
    }
    setPushState(pushAvailable ? "unknown" : "unsupported");
    setEnableMsg(
      pushAvailable
        ? "In-app alerts are on. Background push could not be registered on this device."
        : "In-app alerts are on. Background alerts aren\u2019t configured on this site yet, so you\u2019ll see them when you\u2019re here."
    );
  }, [pushAvailable]);

  const disableNotifications = useCallback(async () => {
    await unsubscribeFromPush();
    setPushState("denied");
    setEnableMsg("Background alerts turned off for this device.");
  }, []);

  /**
   * End-to-end proof for the reader. The pipeline spans a database row, a poll,
   * and a desktop notification, so "I never get alerts" is otherwise impossible
   * to tell apart from "nothing has happened". This writes a real notification
   * and lets the normal poll deliver it.
   */
  const sendTestAlert = useCallback(async () => {
    setEnableMsg(null);
    await fetch("/api/notifications/test", { method: "POST" }).catch(() => {});
    setTestSent(true);
    await load();
    setTimeout(() => setTestSent(false), 4000);
  }, [load]);

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={handleToggle}
        className="relative rounded-lg p-2 text-surface-400 hover:text-surface-50 hover:bg-surface-800 transition-colors"
        aria-label="Notifications"
      >
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
        <Bell className="h-4 w-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 animate-scale-in z-50">
          <div className="overflow-hidden rounded-xl border border-surface-700 bg-surface-900 shadow-xl">
            <div className="flex items-center justify-between border-b border-surface-800 px-4 py-2.5">
              <span className="text-sm font-semibold text-surface-200">
                Notifications
              </span>
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-accent-strong hover:text-brand-700 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

            {canSuggest && (
              <div className="border-b border-surface-800 bg-surface-800/30 px-4 py-2.5">
                <p className="text-[11px] leading-relaxed text-surface-400">
                  Turn on alerts to hear about replies to your stories and about the teams
                  and matches you follow — including goals while a match is live.
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={enableNotifications}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500/15 border border-brand-500/30 px-2.5 py-1 text-[11px] font-semibold text-accent-strong hover:bg-brand-500/25 transition-colors"
                  >
                    <BellRing className="h-3 w-3" />
                    {permState === "denied" ? "Open settings" : "Turn on alerts"}
                  </button>
                  {pushState === "subscribed" && (
                    <button
                      onClick={disableNotifications}
                      className="rounded-lg border border-surface-700 px-2.5 py-1 text-[11px] font-medium text-surface-400 hover:text-surface-200 transition-colors"
                    >
                      Turn off
                    </button>
                  )}
                  {session?.user && (
                    <button
                      onClick={sendTestAlert}
                      disabled={testSent}
                      className="rounded-lg border border-surface-700 px-2.5 py-1 text-[11px] font-medium text-surface-400 hover:text-surface-200 disabled:opacity-50 transition-colors"
                    >
                      {testSent ? "Test sent" : "Send a test"}
                    </button>
                  )}
                </div>
                {!pushAvailable && (
                  <p className="mt-1.5 text-[10px] leading-relaxed text-surface-500">
                    Background alerts (app closed) aren&apos;t configured on this site yet —
                    you&apos;ll get them here while the tab is open.
                  </p>
                )}
                {enableMsg && <p className="mt-1 text-[10px] text-surface-400">{enableMsg}</p>}
              </div>
            )}

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-6 text-center text-xs text-surface-500">
                  Loading...
                </p>
              ) : items.length > 0 ? (
                items.map((notif) => {
                  const Icon = iconFor(notif.type) as typeof Bell;
                  const view = describeNotification(notif);
                  return (
                    <Link
                      key={notif.id}
                      href={view.href}
                      onClick={() => handleItemClick(notif)}
                      className={cn(
                        "flex gap-3 border-b border-surface-800/60 px-4 py-3 transition-colors hover:bg-surface-800/60",
                        !notif.read && "bg-brand-500/5"
                      )}
                    >
                      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-surface-800">
                        <Icon className="h-3.5 w-3.5 text-brand-400" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block text-xs leading-relaxed text-surface-300",
                            !notif.read && "font-medium text-surface-100"
                          )}
                        >
                          <span className="font-semibold text-surface-200">{view.headline}</span>{" "}
                          {view.body}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block text-[10px]",
                            !notif.read ? "text-brand-400" : "text-surface-600"
                          )}
                        >
                          {notif.read ? "Read" : "New"} ·{" "}
                          {timeAgo(notif.createdAt)}
                        </span>
                      </span>
                      {!notif.read && (
                        <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" />
                      )}
                    </Link>
                  );
                })
              ) : (
                <p className="px-4 py-6 text-center text-xs text-surface-500">
                  No notifications yet.
                </p>
              )}
            </div>

            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-surface-800 px-4 py-2.5 text-center text-xs text-brand-400 hover:text-brand-300"
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}