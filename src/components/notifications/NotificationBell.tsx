"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, UserPlus, MessageSquare, Reply, ShieldCheck, BellRing } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import {
  notificationPermissionState,
  playNotificationSound,
  requestNotificationPermission,
  showSystemNotification,
} from "@/lib/permissions";
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
          playNotificationSound();
          showSystemNotification(
            top.actor?.name ? `${top.actor.name} · connectPlus` : "New notification",
            top.title ?? `${top.type?.toLowerCase().replace("_", " ") ?? "update"}${top.post ? ` on “${top.post.title}”` : ""}`,
            {
              sound: true,
              url: top.post ? `/article/${top.post.slug}` : "/notifications",
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
    const res = await requestNotificationPermission("alerts when someone follows you or replies to your stories");
    if (res.status !== "granted") {
      setEnableMsg(res.message);
    }
  }, []);

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
                  Enable browser notifications to get pings — with sound — when someone
                  follows you or replies to your stories, even while you&apos;re elsewhere.
                </p>
                <button
                  onClick={enableNotifications}
                  className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-brand-500/15 border border-brand-500/30 px-2.5 py-1 text-[11px] font-semibold text-accent-strong hover:bg-brand-500/25 transition-colors"
                >
                  <BellRing className="h-3 w-3" />
                  {permState === "denied" ? "Open settings" : "Enable notifications"}
                </button>
                {enableMsg && <p className="mt-1 text-[10px] text-danger-strong">{enableMsg}</p>}
              </div>
            )}

            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <p className="px-4 py-6 text-center text-xs text-surface-500">
                  Loading...
                </p>
              ) : items.length > 0 ? (
                items.map((notif) => {
                  const Icon =
                    (TYPE_ICONS[notif.type] ??
                      (notif.type === "COMMENT"
                        ? MessageSquare
                        : Bell)) as typeof Bell;
                  return (
                    <Link
                      key={notif.id}
                      href={notif.post ? `/article/${notif.post.slug}` : "/"}
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
                          {notif.actor?.name || "Someone"}{" "}
                          {notif.title?.toLowerCase() ||
                            (notif.type === "FOLLOW"
                              ? "followed you"
                              : "interacted with your story")}
                          {notif.post && (
                            <>
                              {" "}
                              <span className="text-surface-500">
                                on {notif.post.title}
                              </span>
                            </>
                          )}
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