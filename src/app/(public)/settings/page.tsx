import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { VerifiedWriterCard } from "@/components/settings/VerifiedWriterCard";
import { SubscriptionManager } from "@/components/subscription/SubscriptionManager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/settings");
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      avatar: true,
      coverImage: true,
      bio: true,
      node: true,
      role: true,
      isVerified: true,
      emailVerified: true,
      createdAt: true,
      _count: { select: { posts: true, followersLinks: true, followingLinks: true } },
    },
  });

  if (!user) redirect("/auth/signin");

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 pb-28 md:pb-10">
        <nav className="flex items-center gap-1.5 text-xs text-surface-400 mb-8">
          <Link href="/" className="hover:text-surface-200 transition-colors">
            Home
          </Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-surface-200">Settings</span>
        </nav>

        <div className="mb-10">
          <h1 className="font-display text-3xl font-bold text-surface-50">
            Account Settings
          </h1>
          <p className="mt-2 text-sm text-surface-400">
            Manage your profile, appearance, and security.
          </p>
        </div>

        <VerifiedWriterCard
          email={user.email}
          role={user.role}
          isVerified={user.isVerified}
          emailVerified={user.emailVerified?.toISOString() ?? null}
        />

        <div className="h-6" />

        <section className="rounded-2xl border border-surface-800/60 bg-surface-900/30 p-6 mb-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-surface-50">Membership</h2>
            <p className="mt-1 text-xs text-surface-500">
              Your reader and writer plans. Cancel or reactivate any time.
            </p>
          </div>
          <SubscriptionManager />
        </section>

        <SettingsForm
          user={{
            id: user.id,
            email: user.email,
            name: user.name ?? "",
            username: user.username,
            avatar: user.avatar,
            coverImage: user.coverImage,
            bio: user.bio ?? "",
            node: user.node ?? "",
            role: user.role,
            isVerified: user.isVerified,
            createdAt: user.createdAt.toISOString(),
            posts: user._count.posts,
            followers: user._count.followersLinks,
            following: user._count.followingLinks,
          }}
        />
      </div>
    </div>
  );
}