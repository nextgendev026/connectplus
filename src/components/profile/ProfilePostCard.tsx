import Link from "next/link";
import { Eye, FileText } from "lucide-react";
import { timeAgo, estimateReadTime } from "@/lib/utils";
import type { ProfileTabPost } from "./ProfileTabs";

export function ProfilePostCard({
  post,
  authorName,
}: {
  post: ProfileTabPost;
  authorName?: string;
}) {
  return (
    <Link
      href={`/article/${post.slug}`}
      className="group flex flex-col rounded-2xl border border-surface-800 bg-surface-900/50 p-5 transition-all duration-300 hover:border-surface-700 hover:shadow-card-hover"
    >
      <h3 className="text-base font-bold text-surface-50 group-hover:text-brand-400 transition-colors">
        {post.title}
      </h3>
      {post.excerpt && (
        <p className="mt-2 flex-1 text-sm text-surface-400 line-clamp-2">
          {post.excerpt}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-surface-500">
        <span>{timeAgo(post.createdAt)}</span>
        <span className="flex items-center gap-1">
          <Eye className="h-3 w-3" />
          {post.viewCount.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <FileText className="h-3 w-3" />
          {estimateReadTime(post.content)}m
        </span>
      </div>
      {authorName && (
        <span className="mt-3 text-xs text-surface-600">
          by {authorName}
        </span>
      )}
    </Link>
  );
}