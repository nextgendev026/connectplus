import { redirect } from "next/navigation";
import Link from "next/link";
import { Bell, ChevronRight } from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MarkAllReadButton } from "./MarkAllRead";
import { NotificationRow } from "./NotificationRow";

export const dynamic = "force-dynamic";

export const metadata = {
  // The brand comes from the root title template — see about/page.tsx.
  title: "Notifications",
  description: "Stay up to date with activity on your connectPlus stories.",
  // A signed-in inbox: nothing here is a public page, and an unauthenticated
  // crawler only ever sees a redirect to sign-in anyway.
  robots: { index: false, follow: false },
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

