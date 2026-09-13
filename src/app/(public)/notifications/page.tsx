import { redirect } from "next/navigation";
import Link from "next/link";
import {
  Bell,
  ChevronRight,
  UserPlus,
  MessageSquare,
  Reply,
  ShieldCheck,
  Trophy,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { timeAgo } from "@/lib/utils";
import { describeNotification } from "@/lib/notification-display";
import { MarkAllReadButton } from "./MarkAllRead";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Notifications - connectPlus",
  description: "Stay up to date with activity on your connectPlus stories.",
};

export default async function NotificationsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/notifications");
  }

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.user.id },
      include: {
        actor: { select: { id: true, name: true, username: true, avatar: true } },
        post: { select: { id: true, slug: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.notification.count({
      where: { userId: session.user.id, read: false },
    }),
  ]);

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <nav className="flex items-center gap-1.5 text-xs text-surface-400 mb-8">
          <Link href="/" className="hover:text-surface-200 transition-colors">
            Home
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-surface-500">Notifications</span>
        </nav>

        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10">
              <Bell className="h-5 w-5 text-brand-400" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold text-surface-50">
                Notifications
              </h1>
              <p className="text-xs text-surface-500">
                {unreadCount > 0
                  ? `${unreadCount} unread`
                  : "You're all caught up"}
              </p>
            </div>
          </div>
          {unreadCount > 0 && <MarkAllReadButton />}
        </div>

        <div className="space-y-3">
          {notifications.length === 0 ? (
            <div className="rounded-2xl border border-surface-800 bg-surface-900/50 px-6 py-12 text-center">
              <Bell className="mx-auto h-8 w-8 text-surface-600" />
              <p className="mt-3 text-sm text-surface-400">
                Nothing yet. Replies and follows show up here, along with goals,
                kick-offs and full-time scores for the matches you follow.
              </p>
            </div>
          ) : (
            notifications.map((notif) => (
              <NotificationRow key={notif.id} notification={notif} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function NotificationRow({
  notification: n,
}: {
  notification: {
    id: string;
    type: string;
    title: string | null;
    message: string | null;
    read: boolean;
    createdAt: Date;
    actor: { id: string; name: string | null; username: string; avatar: string | null } | null;
    post: { id: string; slug: string; title: string } | null;
  };
}) {
  const icons: Record<string, typeof Bell> = {
    FOLLOW: UserPlus,
    COMMENT: MessageSquare,
    REPLY: Reply,
    MODERATION_APPROVED: ShieldCheck,
  };
  const view = describeNotification(n);
  const Icon = view.kind === "sports" ? Trophy : icons[n.type] ?? Bell;
  const href = view.href;

  return (
    <Link
      href={href}
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
        <Icon
          className={n.read ? "h-5 w-5 text-surface-500" : "h-5 w-5 text-brand-400"}
        />
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