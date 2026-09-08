"use client";

import Link from "next/link";
import Image from "next/image";
import {
  Eye,
  MessageCircle,
  Clock,
  Newspaper,
} from "lucide-react";
import { cn, estimateReadTime, truncate } from "@/lib/utils";
import type { PostWithAuthor } from "@/types";
import { TagBadge } from "./TagBadge";
import { BookmarkButton } from "@/components/ui/BookmarkButton";
import { coverSrc } from "@/lib/thumb";

interface PostCardProps {
  post: PostWithAuthor;
  variant?: "default" | "featured" | "compact" | "wide";
}

function postCover(post: PostWithAuthor): string {
  return coverSrc(post.coverImage, {
    title: post.title,
    category: post.category?.name,
    author: post.author.name ?? post.author.username,
    seed: post.slug,
  });
}

function SourceBadge({ post }: { post: PostWithAuthor }) {
  if (!post.source && !post.sourceUrl) return null;
  const label = post.source ? `via ${post.source}` : "via source";
  const inner = (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-800/90 px-2 py-0.5 text-[10px] font-medium text-surface-400 ring-1 ring-surface-700/60 transition-colors hover:text-brand-400 hover:ring-brand-500/30">
      <Newspaper className="h-2.5 w-2.5" />
      {label}
    </span>
  );
  if (post.sourceUrl) {
    return (
      <a
        href={post.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={`Read the original on ${post.source ?? "the source site"}`}
        className="z-10"
      >
        {inner}
      </a>
    );
  }
  return inner;
}

export function PostCard({ post, variant = "default" }: PostCardProps) {
  const readTime = estimateReadTime(post.content);
  const excerpt = post.excerpt || truncate(post.content.replace(/<[^>]+>/g, "").replace(/[#*_~`]/g, ""), 120);
  const commentCount = post._count?.comments ?? 0;

  if (variant === "compact") {
    return (
      <Link href={`/article/${post.slug}`}>
        <article
          className={cn(
            "group relative flex gap-4 rounded-xl border border-surface-800/60 bg-surface-900/50 p-4",
            "transition-all duration-300 hover:border-brand-500/30 hover:bg-surface-800/50 hover:shadow-glow"
          )}
        >
          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg">
            <Image
              src={postCover(post)}
              alt={post.title}
              fill
              className="object-cover transition-transform duration-500 group-hover:scale-110"
            />
          </div>
          <div className="flex flex-1 flex-col justify-center gap-1 min-w-0">
            <h3 className="font-display text-sm font-semibold text-surface-50 leading-snug line-clamp-2 transition-colors group-hover:text-brand-400">
              {post.title}
            </h3>
            <div className="flex items-center gap-3 text-xs text-surface-400">
              <span className="flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {post.viewCount.toLocaleString()}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="h-3 w-3" />
                {commentCount}
              </span>
            </div>
          </div>
        </article>
      </Link>
    );
  }

  if (variant === "wide") {
    return (
      <Link href={`/article/${post.slug}`}>
        <article
          className={cn(
            "group relative flex overflow-hidden rounded-2xl border border-surface-800/60 bg-surface-900/50",
            "transition-all duration-500 hover:border-brand-500/30 hover:shadow-card-hover"
          )}
        >
          <div className="relative h-64 w-2/5 flex-shrink-0 overflow-hidden">
            <Image
              src={postCover(post)}
              alt={post.title}
              fill
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-surface-900/80" />
          </div>
          <div className="flex flex-1 flex-col justify-between p-6">
            <div>
              <div className="mb-3 flex items-center gap-3">
                <Image
                  src={post.author.avatar || "https://i.pravatar.cc/300?img=0"}
                  alt={post.author.name || post.author.username}
                  width={28}
                  height={28}
                  className="rounded-full ring-2 ring-surface-700"
                />
                <span className="text-sm text-surface-300">
                  {post.author.name || post.author.username}
                </span>
                {post.publishedAt && (
                  <span className="text-xs text-surface-500">
                    {new Date(post.publishedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              <h2 className="font-display text-xl font-bold text-surface-50 leading-tight transition-colors group-hover:text-brand-400">
                {post.title}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-surface-400 line-clamp-2">
                {excerpt}
              </p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex flex-wrap gap-2">
                {post.tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag.id} tag={tag} size="sm" showLink={false} />
                ))}
              </div>
              <div className="flex items-center gap-4 text-xs text-surface-400">
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  {readTime} min read
                </span>
                <span className="flex items-center gap-1">
                  <Eye className="h-3.5 w-3.5" />
                  {post.viewCount.toLocaleString()}
                </span>
                <span className="flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {commentCount}
                </span>
              </div>
            </div>
          </div>
        </article>
      </Link>
    );
  }

  if (variant === "featured") {
    return (
      <Link href={`/article/${post.slug}`}>
        <article
          className={cn(
            "group relative col-span-2 row-span-2 overflow-hidden rounded-2xl border border-surface-800/40",
            "transition-all duration-500 hover:border-brand-500/40 hover:shadow-glow-lg"
          )}
        >
<div className="absolute inset-0">
            <Image
              src={postCover(post)}
              alt={post.title}
              fill
              priority
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent" />
          </div>

          <div className="relative flex h-full flex-col justify-end p-8">
            {post.category && (
              <span className="mb-3 w-fit rounded-full bg-brand-500/20 px-3 py-1 text-xs font-medium text-brand-400 ring-1 ring-brand-500/30">
                {post.category.name}
              </span>
            )}

            <h2 className="font-display text-3xl font-bold text-white leading-tight transition-colors group-hover:text-brand-300">
              {post.title}
            </h2>

            {excerpt && (
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/85 line-clamp-3">
                {excerpt}
              </p>
            )}

            <div className="mt-5 flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <div className="relative h-10 w-10 overflow-hidden rounded-full ring-2 ring-brand-500/30">
                  <Image
                    src={post.author.avatar || "https://i.pravatar.cc/300?img=0"}
                    alt={post.author.name || post.author.username}
                    fill
                    className="object-cover"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {post.author.name || post.author.username}
                  </p>
                  <p className="text-xs text-white/70">@{post.author.username}</p>
                </div>
              </div>

              <div className="ml-auto flex items-center gap-5 text-sm text-white/80">
                {post.publishedAt && (
                  <span>
                    {new Date(post.publishedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {readTime} min
                </span>
                <span className="flex items-center gap-1.5">
                  <Eye className="h-4 w-4" />
                  {post.viewCount.toLocaleString()}
                </span>
                <span className="flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4" />
                  {commentCount}
                </span>
              </div>
            </div>

            {post.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {post.tags.slice(0, 4).map((tag) => (
                  <TagBadge key={tag.id} tag={tag} size="sm" showLink={false} />
                ))}
              </div>
            )}
          </div>

          <BookmarkButton
            postId={post.id}
            className="absolute right-6 top-6 p-2.5"
          />
        </article>
      </Link>
    );
  }

  // Default variant
  return (
    <Link href={`/article/${post.slug}`}>
      <article
        className={cn(
          "group relative flex flex-col overflow-hidden rounded-2xl border border-surface-800/60 bg-surface-900/50",
          "transition-all duration-500 hover:border-brand-500/30 hover:shadow-card-hover hover:-translate-y-1"
        )}
      >
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image
            src={postCover(post)}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-700 group-hover:scale-110"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          {post.category && (
            <span className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-brand-300 backdrop-blur-sm ring-1 ring-white/15">
              {post.category.name}
            </span>
          )}

          <BookmarkButton
            postId={post.id}
            className="absolute right-4 top-4 p-2 opacity-0 group-hover:opacity-100"
          />
        </div>

        <div className="flex flex-1 flex-col p-5">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="relative h-8 w-8 overflow-hidden rounded-full ring-1 ring-surface-700">
              <Image
                src={post.author.avatar || "https://i.pravatar.cc/300?img=0"}
                alt={post.author.name || post.author.username}
                fill
                className="object-cover"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-surface-200">
                {post.author.name || post.author.username}
              </span>
              {post.publishedAt && (
                <>
                  <span className="text-surface-600">&middot;</span>
                  <span className="text-xs text-surface-500">
                    {new Date(post.publishedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </>
              )}
            </div>
          </div>

          <h3 className="font-display text-lg font-bold text-surface-50 leading-snug transition-colors group-hover:text-brand-400 line-clamp-2">
            {post.title}
          </h3>

          <p className="mt-2 flex-1 text-sm leading-relaxed text-surface-400 line-clamp-3">
            {excerpt}
          </p>

          {post.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {post.tags.slice(0, 3).map((tag) => (
                <TagBadge key={tag.id} tag={tag} size="sm" showLink={false} />
              ))}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2 border-t border-surface-800/60 pt-4 text-xs text-surface-400">
            <SourceBadge post={post} />
            <div className="ml-auto flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                {readTime} min read
              </span>
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                {post.viewCount.toLocaleString()}
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="h-3.5 w-3.5" />
                {commentCount}
              </span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
