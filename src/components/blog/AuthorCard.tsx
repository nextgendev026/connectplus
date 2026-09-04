"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  UserPlus,
  UserCheck,
  FileText,
  Users,
  MapPin,
  LinkIcon,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Author {
  id: string;
  name: string | null;
  username: string;
  avatar: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  followersCount: number;
  postsCount: number;
  joinedAt?: string;
}

interface AuthorCardProps {
  author: Author;
  currentUserId?: string;
  className?: string;
}

export function AuthorCard({
  author,
  currentUserId,
  className,
}: AuthorCardProps) {
  const [isFollowing, setIsFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(author.followersCount);
  const [isAnimating, setIsAnimating] = useState(false);

  const isOwnProfile = currentUserId === author.id;

  const handleFollowToggle = useCallback(() => {
    setIsAnimating(true);
    setIsFollowing((prev) => {
      setFollowerCount((count) => (prev ? count - 1 : count + 1));
      return !prev;
    });
    setTimeout(() => setIsAnimating(false), 300);
  }, []);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-surface-800/60 bg-surface-900/70 backdrop-blur-sm",
        className
      )}
    >
      <div className="relative h-24 bg-gradient-to-br from-brand-600/30 via-brand-700/20 to-surface-900">
        <div className="absolute inset-0 bg-mesh-gradient opacity-50" />
      </div>

      <div className="relative px-6 pb-6">
        <div className="-mt-12 flex items-end justify-between">
          <div className="relative h-24 w-24 overflow-hidden rounded-2xl border-4 border-surface-900 ring-2 ring-surface-700">
            <Image
              src={author.avatar || "/avatars/default.png"}
              alt={author.name || author.username}
              fill
              className="object-cover"
            />
          </div>

          {!isOwnProfile && (
            <button
              onClick={handleFollowToggle}
              className={cn(
                "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-300",
                isFollowing
                  ? "border border-surface-600 bg-surface-800 text-surface-300 hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400"
                  : "bg-brand-600 text-white shadow-glow hover:bg-brand-500",
                isAnimating && "scale-95"
              )}
            >
              {isFollowing ? (
                <>
                  <UserCheck className="h-4 w-4" />
                  Following
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Follow
                </>
              )}
            </button>
          )}
        </div>

        <div className="mt-4">
          <Link
            href={`/profile/${author.username}`}
            className="group flex items-center gap-2"
          >
            <h3 className="font-display text-xl font-bold text-white transition-colors group-hover:text-brand-400">
              {author.name || author.username}
            </h3>
            <ExternalLink className="h-4 w-4 text-surface-500 opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <p className="text-sm text-surface-400">@{author.username}</p>

          {author.bio && (
            <p className="mt-3 text-sm leading-relaxed text-surface-300">
              {author.bio}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-surface-500">
            {author.location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {author.location}
              </span>
            )}
            {author.website && (
              <a
                href={author.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-brand-400 transition-colors hover:text-brand-300"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {author.website.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </a>
            )}
            {author.joinedAt && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                Joined{" "}
                {new Date(author.joinedAt).toLocaleDateString("en-GB", {
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
          </div>

          <div className="mt-5 flex items-center gap-6 border-t border-surface-800/60 pt-5">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-surface-500" />
              <div>
                <span className="block text-sm font-bold text-white">
                  {author.postsCount}
                </span>
                <span className="text-[11px] text-surface-500">Posts</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-surface-500" />
              <div>
                <span className="block text-sm font-bold text-white">
                  {followerCount.toLocaleString()}
                </span>
                <span className="text-[11px] text-surface-500">Followers</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
