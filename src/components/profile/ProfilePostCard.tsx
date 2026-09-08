import Link from "next/link";
import Image from "next/image";
import {
  Eye,
  Clock,
  Heart,
  MessageCircle,
  Sparkles,
  Bookmark,
} from "lucide-react";
import { cn, timeAgo, estimateReadTime } from "@/lib/utils";
import { coverSrc } from "@/lib/thumb";

export interface ProfileTabPost {
  id: string;
  slug: string;
  title: string;
  excerpt?: string | null;
  viewCount: number;
  content: string;
  createdAt: string;
  coverImage?: string | null;
  featured?: boolean;
  category?: { name: string; slug: string } | null;
  tags?: { id: string; name: string; slug: string }[];
  likeCount?: number;
  commentCount?: number;
  authorName?: string;
}

export function ProfilePostCard({
  post,
  layout = "grid",
  variant = "post",
}: {
  post: ProfileTabPost;
  layout?: "grid" | "list";
  variant?: "post" | "saved";
}) {
  const isList = layout === "list";
  const readTime = estimateReadTime(post.content);

  return (
    <Link
      href={`/article/${post.slug}`}
      className={cn(
        "group relative flex overflow-hidden rounded-2xl border border-surface-800/70 bg-surface-900/60 transition-all duration-300 hover:border-brand-500/40 hover:shadow-card-hover",
        isList ? "flex-row" : "flex-col"
      )}
    >
      {/* Media */}
      <div
        className={cn(
          "relative shrink-0 overflow-hidden bg-gradient-to-br from-surface-800 to-surface-900",
          isList ? "h-auto w-24 sm:w-32 md:w-36" : "h-32 sm:h-36"
        )}
      >
        <Image
          src={coverSrc(post.coverImage, {
            title: post.title,
            category: post.category?.name,
            seed: post.slug,
          })}
          alt={post.title}
          fill
          sizes={isList ? "144px" : "(max-width: 640px) 100vw, 33vw"}
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        {post.featured && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-brand-500/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-glow">
            <Sparkles className="h-2.5 w-2.5" />
            Featured
          </span>
        )}
        {variant === "saved" && (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-brand-400 backdrop-blur-sm">
            <Bookmark className="h-3 w-3 fill-current" />
          </span>
        )}
      </div>

      {/* Body */}
      <div className={cn("flex flex-1 flex-col p-3 sm:p-4", isList && "py-3 pl-3 pr-4 sm:py-3.5 sm:pl-3.5")}>
        <div className="mb-1 flex items-center gap-1.5 text-[9px] font-medium sm:mb-1.5 sm:gap-2 sm:text-[10px]">
          {post.category && (
            <span className="rounded-full border border-brand-500/20 bg-brand-500/10 px-2 py-0.5 uppercase tracking-wider text-brand-400">
              {post.category.name}
            </span>
          )}
          <span className="text-surface-600">{timeAgo(post.createdAt)}</span>
        </div>

        <h3
          className={cn(
            "font-semibold leading-snug text-surface-50 transition-colors group-hover:text-brand-400",
            isList ? "line-clamp-2 text-sm" : "line-clamp-2 text-[13px] sm:text-sm md:text-base"
          )}
        >
          {post.title}
        </h3>

        {!isList && post.excerpt && (
          <p className="mt-1 flex-1 text-[11px] leading-relaxed text-surface-400 line-clamp-2 sm:text-xs">
            {post.excerpt}
          </p>
        )}

        {isList && post.excerpt && (
          <p className="mt-1 hidden flex-1 text-[11px] leading-relaxed text-surface-400 line-clamp-1 sm:block sm:text-xs">
            {post.excerpt}
          </p>
        )}

        {/* Meta footer */}
        <div
          className={cn(
            "mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 text-[10px] text-surface-500 sm:gap-x-3 sm:pt-2.5 sm:text-[11px]",
            isList && "pt-1.5 sm:pt-2"
          )}
        >
          {post.authorName && (
            <span className="max-w-[120px] truncate text-surface-400">
              {post.authorName}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {post.viewCount.toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-1">
            <Heart className="h-3 w-3" />
            {post.likeCount ?? 0}
          </span>
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3 w-3" />
            {post.commentCount ?? 0}
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-surface-600">
            <Clock className="h-3 w-3" />
            {readTime}m
          </span>
        </div>

        {/* Tags (grid only, keeps list rows tight) */}
        {!isList && post.tags && post.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-surface-800/60 pt-2 sm:mt-2.5 sm:gap-1.5 sm:pt-2.5">
            {post.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="rounded-md bg-surface-800/80 px-1.5 py-0.5 text-[9px] font-medium text-surface-400 sm:text-[10px]"
              >
                #{tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </Link>
  );
}
