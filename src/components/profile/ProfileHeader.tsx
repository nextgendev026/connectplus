"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  MapPin,
  Calendar,
  Eye,
  Settings,
  ChevronLeft,
  Heart,
  FileText,
  Users,
  UserPlus,
  BadgeCheck,
} from "lucide-react";
import { formatDate, cn } from "@/lib/utils";
import { FollowButton } from "@/components/ui/FollowButton";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { ProfileShareButton } from "@/components/profile/ProfileShareButton";
import { ProfileListModal, type ModalTab } from "@/components/profile/ProfileListModal";

interface ProfileHeaderProps {
  user: {
    id: string;
    name: string | null;
    username: string;
    avatar: string | null;
    coverImage: string | null;
    bio: string | null;
    node: string | null;
    isVerified: boolean;
    createdAt: Date;
    followersCount: number;
    followingCount: number;
    _count: { posts: number };
  };
  totalViews: number;
  totalLikes: number;
  viewerFollow: boolean;
  isOwn: boolean;
}

export function ProfileHeader({
  user,
  totalViews,
  totalLikes,
  viewerFollow,
  isOwn,
}: ProfileHeaderProps) {
  const [modalTab, setModalTab] = useState<ModalTab | null>(null);

  const displayName = user.name ?? user.username;
  const initials = displayName
    .split(/\s+/)
    .map((w: string) => w.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const statItems = [
    {
      label: "Posts",
      value: user._count.posts,
      icon: FileText,
      modalTab: null,
    },
    {
      label: "Followers",
      value: user.followersCount,
      icon: Users,
      modalTab: "followers" as ModalTab,
    },
    {
      label: "Following",
      value: user.followingCount,
      icon: UserPlus,
      modalTab: "following" as ModalTab,
    },
    {
      label: "Likes",
      value: totalLikes,
      icon: Heart,
      modalTab: null,
    },
  ];

  return (
    <>
      {/* ── Cover ─────────────────────────────────────────────────────── */}
      <div className="relative h-44 sm:h-60 md:h-72">
        {user.coverImage ? (
          <Image
            src={user.coverImage}
            alt=""
            fill
            priority
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-600/40 via-surface-850 to-accent-cyan/10" />
        )}
        {/* Legibility gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface-950 via-surface-950/20 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent" />

        {/* Top bar: back + actions */}
        <div className="absolute inset-x-0 top-0">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-4 sm:px-6">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3.5 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md transition-all hover:bg-black/50 hover:text-white"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Feed
            </Link>
            <div className="flex items-center gap-2">
              <ProfileShareButton username={user.username} displayName={displayName} />
              {isOwn && (
                <Link
                  href="/settings"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/30 text-white/90 backdrop-blur-md transition-all hover:bg-black/50 hover:text-white"
                  aria-label="Settings"
                >
                  <Settings className="h-4 w-4" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Header card ───────────────────────────────────────────────── */}
      <div className="relative mx-auto max-w-5xl px-4 sm:px-6">
        <div className="-mt-14 sm:-mt-16">
          <div className="rounded-3xl border border-surface-800/70 bg-surface-900/80 shadow-card backdrop-blur-xl">
            <div className="p-4 sm:p-6 lg:p-7">
              {/* Identity row */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="relative shrink-0">
                    <div className="absolute -inset-1 rounded-3xl bg-gradient-to-br from-brand-500/60 via-brand-500/20 to-accent-cyan/40 blur-md opacity-70" />
                    {user.avatar ? (
                      <Image
                        src={user.avatar}
                        alt={displayName}
                        width={96}
                        height={96}
                        priority
                        className="relative h-16 w-16 rounded-2xl border-2 border-surface-700/60 object-cover sm:h-20 sm:w-20 md:h-24 md:w-24"
                      />
                    ) : (
                      <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-surface-700/60 bg-gradient-to-br from-surface-800 to-surface-900 text-xl font-bold text-surface-300 sm:h-20 sm:w-20 sm:text-2xl md:h-24 md:w-24 md:text-3xl">
                        {initials}
                      </div>
                    )}
                    {user.isVerified && (
                      <span
                        className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface-900 bg-brand-500 text-white shadow-glow sm:-bottom-1.5 sm:-right-1.5 sm:h-7 sm:w-7"
                        title="Verified writer"
                      >
                        <BadgeCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 pt-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="truncate text-lg font-bold tracking-tight text-surface-50 sm:text-xl md:text-2xl">
                        {displayName}
                      </h1>
                      {user.isVerified && (
                        <span className="hidden items-center gap-1 rounded-full border border-brand-500/30 bg-brand-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand-400 sm:inline-flex">
                          <BadgeCheck className="h-3 w-3" />
                          Verified
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs font-medium text-surface-400 sm:text-sm">
                      @{user.username}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-surface-500 sm:gap-x-4 sm:text-xs">
                      {user.node && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-brand-400/80 sm:h-3.5 sm:w-3.5" />
                          {user.node}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                        Joined {formatDate(user.createdAt)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Eye className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                        {totalViews.toLocaleString()} views
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex shrink-0 items-center gap-2 sm:pt-1">
                  <FollowButton
                    targetId={user.id}
                    initialFollowing={viewerFollow}
                    followersCount={user.followersCount}
                    className="flex-1 sm:flex-none"
                  />
                  {isOwn && <SignOutButton className="hidden sm:flex h-10" />}
                </div>
              </div>

              {/* Bio */}
              {user.bio && (
                <p className="mt-4 max-w-2xl text-sm leading-relaxed text-surface-300">
                  {user.bio}
                </p>
              )}

              {/* Stat strip */}
              <div className="mt-4 grid grid-cols-4 gap-2 sm:mt-5 sm:gap-3">
                {statItems.map((stat) => {
                  const clickable = stat.modalTab !== null;
                  return (
                    <button
                      key={stat.label}
                      onClick={() => {
                        if (clickable && stat.modalTab) setModalTab(stat.modalTab);
                      }}
                      className={cn(
                        "rounded-2xl border border-surface-800/70 bg-surface-850/60 px-2 py-2.5 text-center transition-all sm:py-3",
                        clickable
                          ? "cursor-pointer hover:border-brand-500/40 hover:bg-surface-800/60"
                          : "hover:border-surface-700"
                      )}
                    >
                      <stat.icon className="mx-auto mb-1 h-3 w-3 text-brand-400/90 sm:mb-1.5 sm:h-3.5 sm:w-3.5" />
                      <p className="text-sm font-bold leading-none text-surface-50 sm:text-base md:text-lg">
                        {stat.value.toLocaleString()}
                      </p>
                      <p className="mt-0.5 text-[9px] font-medium uppercase tracking-wide text-surface-500 sm:text-[10px] md:text-[11px]">
                        {stat.label}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <ProfileListModal
        open={modalTab === "followers"}
        onClose={() => setModalTab(null)}
        username={user.username}
        tab="followers"
        total={user.followersCount}
      />
      <ProfileListModal
        open={modalTab === "following"}
        onClose={() => setModalTab(null)}
        username={user.username}
        tab="following"
        total={user.followingCount}
      />
    </>
  );
}
