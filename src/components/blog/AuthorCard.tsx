"use client";

import Image from "next/image";
import Link from "next/link";
import {
  FileText,
  Users,
  MapPin,
  LinkIcon,
  Calendar,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FollowButton } from "@/components/ui/FollowButton";

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
  initialFollowing?: boolean;
  className?: string;
}

export function AuthorCard({
  author,
  currentUserId,
  initialFollowing = false,
  className,
}: AuthorCardProps) {
  const isOwnProfile = currentUserId === author.id;

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
              src={author.avatar || "https://i.pravatar.cc/300?img=0"}
              alt={author.name || author.username}
              fill
              className="object-cover"
            />
          </div>

          {!isOwnProfile && (
            <FollowButton
              targetId={author.id}
              initialFollowing={initialFollowing}
              followersCount={author.followersCount}
            />
          )}
        </div>

        <div className="mt-4">
          <Link
            href={`/profile/${author.username}`}
            className="group flex items-center gap-2"
          >
            <h3 className="font-display text-xl font-bold text-surface-50 transition-colors group-hover:text-brand-400">
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
                <span className="block text-sm font-bold text-surface-50">
                  {author.postsCount}
                </span>
                <span className="text-[11px] text-surface-500">Posts</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-surface-500" />
              <div>
                <span className="block text-sm font-bold text-surface-50">
                  {author.followersCount.toLocaleString()}
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
