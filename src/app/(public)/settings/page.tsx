import { redirect } from "next/navigation";
import {
  UserRound,
  Lock,
  ShieldCheck,
  ImageIcon,
  ChevronRight,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SettingsForm } from "@/components/settings/SettingsForm";

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
      createdAt: true,
      _count: { select: { posts: true, followersLinks: true, followingLinks: true } },
    },
  });

  if (!user) redirect("/auth/signin");

  return (
    <div className="min-h-screen bg-surface-950">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <nav className="flex items-center gap-1.5 text-xs text-surface-400 mb-8">
          <a href="/" className="hover:text-surface-200 transition-colors">
            Home
          </a>
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