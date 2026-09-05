"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, FileText, FolderOpen, Info, Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { ProfilePostCard } from "./ProfilePostCard";

export interface ProfileTabPost {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  viewCount: number;
  content: string;
  createdAt: string;
  authorName?: string;
}

export interface ProfileStats {
  totalViews: number;
  totalLikes: number;
}

interface ProfileTabsProps {
  posts: ProfileTabPost[];
  savedPosts: ProfileTabPost[];
  ownProfile: boolean;
  stats: ProfileStats;
  about?: string | null;
  children?: React.ReactNode;
}

const TABS = [
  { id: "posts", label: "Posts", icon: FileText },
  { id: "saved", label: "Saved", icon: FolderOpen },
  { id: "about", label: "About", icon: Info },
  { id: "stats", label: "Statistics", icon: Heart },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function ProfileTabs({
  posts,
  savedPosts,
  ownProfile,
  stats,
  about,
  children,
}: ProfileTabsProps) {
  const [active, setActive] = useState<TabId>("posts");

  const visibleTabs = TABS.filter((t) => !(t.id === "saved" && !ownProfile));

  return (
    <div>
      <div className="mt-8 border-b border-surface-800">
        <div className="flex gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 -mb-px px-4 py-3 text-sm font-medium transition-colors",
                active === tab.id
                  ? "border-brand-500 text-brand-400"
                  : "border-transparent text-surface-500 hover:text-surface-50"
              )}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="py-8">
        {active === "posts" && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {posts.length > 0 ? (
              posts.map((post) => (
                <ProfilePostCard key={post.id} post={post} />
              ))
            ) : (
              <EmptyState text="No stories published yet." />
            )}
          </div>
        )}

        {active === "saved" && ownProfile && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {savedPosts.length > 0 ? (
              savedPosts.map((post) => (
                <ProfilePostCard key={post.id} post={post} authorName={post.authorName} />
              ))
            ) : (
              <EmptyState text="You haven't saved any stories yet." />
            )}
          </div>
        )}

        {active === "about" && (
          <div className="max-w-2xl space-y-4">
            {about ? (
              <p className="text-surface-300 leading-relaxed">{about}</p>
            ) : (
              <EmptyState text="No bio yet." />
            )}
            {children}
          </div>
        )}

        {active === "stats" && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 max-w-2xl">
            <StatTile label="Total views" value={stats.totalViews.toLocaleString()} icon={Eye} />
            <StatTile label="Total likes" value={stats.totalLikes.toLocaleString()} icon={Heart} />
            <StatTile label="Posts" value={posts.length.toLocaleString()} icon={FileText} />
            <StatTile label="Saved" value={savedPosts.length.toLocaleString()} icon={FolderOpen} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof Eye;
}) {
  return (
    <div className="rounded-xl border border-surface-800 bg-surface-900/50 p-4">
      <Icon className="h-4 w-4 text-brand-400 mb-2" />
      <p className="text-xl font-bold text-surface-50">{value}</p>
      <p className="text-xs text-surface-500">{label}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="col-span-full rounded-2xl border border-dashed border-surface-800 p-10 text-center">
      <p className="text-sm text-surface-500">{text}</p>
      <Link href="/studio" className="mt-3 inline-block text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors">
        Write your first story →
      </Link>
    </div>
  );
}