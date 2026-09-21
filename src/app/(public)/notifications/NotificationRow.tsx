"use client";

import Link from "next/link";
import { Bell, UserPlus, MessageSquare, Reply, ShieldCheck, Trophy } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import { describeNotification } from "@/lib/notification-display";

interface NotificationRowProps {
  notification: {
    id: string;
    type: string;
    title: string | null;
    message: string | null;
    read: boolean;
    createdAt: Date | string;
    actor: { id: string; name: string | null; username: string; avatar: string | null } | null;
    post: { id: string; slug: string; title: string } | null;
  };
}

const ICONS: Record<string, typeof Bell> = {
  FOLLOW: UserPlus,
  COMMENT: MessageSquare,
  REPLY: Reply,
  MODERATION_APPROVED: ShieldCheck,
};

/**
 * One row of the inbox.
 *
 * Client-side only for the click handler, and it marks the notification read as
 * the reader opens it. The list previously had no handler at all, so opening a
 * story *from* the notifications page left it unread — the one place a reader
 * is most obviously consuming the notification was the one place that never
 * recorded it. The request is deliberately not awaited: the navigation is the
 * thing the reader asked for, and blocking it on a bookkeeping write would make
 * the tap feel slow for no benefit.
 */
export function NotificationRow({ notification: n }: NotificationRowProps) {
  const view = describeNotification(n);
  const Icon = view.kind === "sports" ? Trophy : ICONS[n.type] ?? Bell;

  const markRead = () => {
    if (n.read) return;
    fetch("/api/notifications/read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [n.id] }),
      keepalive: true,
    }).catch(() => {});
  };

  return (
    <Link
      href={view.href}
      onClick={markRead}
      className={`flex items-start gap-4 rounded-2xl border px-4 py-4 transition-colors hover:bg-surface-900/70 ${
        n.read
          ? "border-surface-800 bg-surface-900/40"
          : "border-brand-500/20 bg-brand-500/5"
      }`}
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
          n.read ? "bg-surface-800" : "bg-brand-500/15"
        }`}
      >
        <Icon className={n.read ? "h-5 w-5 text-surface-500" : "h-5 w-5 text-brand-400"} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm ${n.read ? "text-surface-400" : "text-surface-100"}`}>
          <span className="font-semibold text-surface-100">{view.headline}</span>{" "}
          {view.body}
        </p>
        <p className="mt-1 text-xs text-surface-600">{timeAgo(n.createdAt)}</p>
      </div>
      {!n.read && <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" />}
    </Link>
  );
}
