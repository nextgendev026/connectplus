"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Bell, UserPlus, MessageSquare, Reply, ShieldCheck } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

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

  const load = useCallback(async () => {
    if (!session?.user) return;
    setLoading(true);
    try {
      const res = await fetch("/api/notifications?limit=10");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [session?.user]);

  useEffect(() => {
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
                  className="text-xs text-brand-400 hover:text-brand-300 transition-colors"
                >
                  Mark all read
                </button>
              )}
            </div>

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