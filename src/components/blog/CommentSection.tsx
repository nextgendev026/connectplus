"use client";

import { useState, useCallback, useEffect } from "react";
import Image from "next/image";
import { useSession } from "next-auth/react";
import {
  Heart,
  Reply,
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Send,
  CornerDownRight,
} from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

interface CommentAuthor {
  id: string;
  name: string | null;
  username: string;
  avatar: string | null;
}

interface ApiComment {
  id: string;
  content: string;
  createdAt: string;
  author: CommentAuthor;
  _count: { likes: number };
  replies: ApiComment[];
}

interface CommentSectionProps {
  postId: string;
  className?: string;
}

function CommentItem({
  comment,
  depth = 0,
  onReply,
}: {
  comment: ApiComment;
  depth?: number;
  onReply: (parentId: string) => void;
}) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(comment._count?.likes ?? 0);
  const [showReplies, setShowReplies] = useState(depth === 0);

  const handleLike = useCallback(() => {
    setLiked((prev) => !prev);
    setLikeCount((prev) => (liked ? prev - 1 : prev + 1));
  }, [liked]);

  return (
    <div
      className={cn(
        "group/comment",
        depth > 0 && "ml-8 mt-3 border-l-2 border-surface-800 pl-5"
      )}
    >
      <div className="flex gap-3">
        <div className="relative h-9 w-9 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-surface-700">
          <Image
            src={comment.author.avatar || "https://i.pravatar.cc/300?img=0"}
            alt={comment.author.name || comment.author.username}
            fill
            className="object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-surface-200">
              {comment.author.name || comment.author.username}
            </span>
            <span className="text-xs text-surface-500">
              @{comment.author.username}
            </span>
            <span className="text-surface-600">&middot;</span>
            <span className="text-xs text-surface-500">
              {timeAgo(comment.createdAt)}
            </span>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-surface-300">
            {comment.content}
          </p>

          <div className="mt-2 flex items-center gap-1">
            <button
              onClick={handleLike}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-all",
                liked
                  ? "text-brand-400 hover:bg-brand-500/10"
                  : "text-surface-500 hover:bg-surface-800 hover:text-surface-300"
              )}
            >
              <Heart
                className={cn("h-3.5 w-3.5", liked && "fill-brand-400")}
              />
              {likeCount > 0 && <span>{likeCount}</span>}
            </button>
            <button
              onClick={() => onReply(comment.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-surface-500 transition-all hover:bg-surface-800 hover:text-surface-300"
            >
              <Reply className="h-3.5 w-3.5" />
              Reply
            </button>
            <button className="rounded-md p-1 text-surface-600 opacity-0 transition-all hover:bg-surface-800 hover:text-surface-400 group-hover/comment:opacity-100">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {comment.replies.length > 0 && depth === 0 && (
        <div className="mt-2 ml-12">
          <button
            onClick={() => setShowReplies((prev) => !prev)}
            className="flex items-center gap-1 text-xs font-medium text-brand-400 transition-colors hover:text-brand-300"
          >
            {showReplies ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showReplies ? "Hide" : "Show"} {comment.replies.length}{" "}
            {comment.replies.length === 1 ? "reply" : "replies"}
          </button>
        </div>
      )}

      {showReplies &&
        comment.replies.map((reply) => (
          <CommentItem
            key={reply.id}
            comment={reply}
            depth={depth + 1}
            onReply={onReply}
          />
        ))}
    </div>
  );
}

export function CommentSection({ postId, className }: CommentSectionProps) {
  const { data: session } = useSession();
  const [comments, setComments] = useState<ApiComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "popular">("newest");

  const user = session?.user;
  const userAvatar = user?.avatar ?? user?.image ?? null;

  const loadComments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/comments?postId=${encodeURIComponent(postId)}`);
      if (!res.ok) throw new Error("Failed to load comments");
      const data = await res.json();
      setComments(data.comments ?? []);
      setError(null);
    } catch {
      setError("Could not load comments. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: the sync setState is only an idempotent loading flag
    loadComments();
  }, [loadComments]);

  const totalComments = comments.reduce(
    (acc, c) => acc + 1 + (c.replies?.length ?? 0),
    0
  );

  const handleSubmit = useCallback(async () => {
    const content = newComment.trim();
    if (!content) return;

    if (!user?.id) {
      setError("You must be signed in to comment.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postId,
          content,
          parentId: replyingTo ?? null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Failed to post comment.");
        return;
      }
      const data = await res.json();

      if (replyingTo) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyingTo
              ? { ...c, replies: [...(c.replies ?? []), data.comment] }
              : c
          )
        );
      } else {
        setComments((prev) => [data.comment, ...prev]);
      }

      setNewComment("");
      setReplyingTo(null);
      setError(null);
    } catch {
      setError("Failed to post comment. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [newComment, replyingTo, postId, user?.id]);

  const handleReply = useCallback((parentId: string) => {
    setReplyingTo(parentId);
    setError(null);
  }, []);

  const sortedComments = [...comments].sort((a, b) => {
    if (sortBy === "popular")
      return (b._count?.likes ?? 0) - (a._count?.likes ?? 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <section className={cn("w-full", className)}>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-xl font-bold text-surface-50">
          Comments{" "}
          <span className="text-surface-500">({totalComments})</span>
        </h3>
        <div className="flex rounded-lg bg-surface-800/50 p-0.5">
          {(["newest", "popular"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setSortBy(option)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-all",
                sortBy === option
                  ? "bg-surface-700 text-surface-50 shadow-sm"
                  : "text-surface-400 hover:text-surface-200"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="flex gap-3">
          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-surface-700 bg-surface-800">
            {userAvatar ? (
              <Image
                src={userAvatar}
                alt="Your avatar"
                fill
                className="object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-sm font-bold text-surface-400">
                {(user?.name ?? "G").charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1">
            <div className="relative">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={
                  !user
                    ? "Sign in to share your thoughts..."
                    : replyingTo
                    ? "Write a reply..."
                    : "Share your thoughts..."
                }
                rows={3}
                disabled={!user}
                className={cn(
                  "w-full resize-none rounded-xl border border-surface-700/50 bg-surface-800/50 px-4 py-3 text-sm text-surface-50 placeholder-surface-500",
                  "transition-all focus:border-brand-500/50 focus:outline-none focus:ring-1 focus:ring-brand-500/30",
                  "disabled:cursor-not-allowed disabled:opacity-60"
                )}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    handleSubmit();
                  }
                }}
              />
              {replyingTo && (
                <div className="flex items-center gap-2 border-t border-surface-700/50 px-4 py-2">
                  <CornerDownRight className="h-3.5 w-3.5 text-brand-400" />
                  <span className="text-xs text-surface-400">
                    Replying to a comment
                  </span>
                  <button
                    onClick={() => setReplyingTo(null)}
                    className="ml-auto text-xs text-surface-500 hover:text-surface-300"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-surface-600">
                Press Ctrl+Enter to submit
              </span>
              <button
                onClick={handleSubmit}
                disabled={!newComment.trim() || submitting || !user}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  newComment.trim() && user
                    ? "bg-brand-600 text-white hover:bg-brand-500 shadow-glow"
                    : "bg-surface-800 text-surface-500 cursor-not-allowed"
                )}
              >
                {submitting ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {replyingTo ? "Reply" : "Comment"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-6 divide-y divide-surface-800/60">
        {loading ? (
          <div className="flex items-center gap-3 py-8 text-sm text-surface-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500/40 border-t-brand-500" />
            Loading comments...
          </div>
        ) : sortedComments.length > 0 ? (
          sortedComments.map((comment) => (
            <div key={comment.id} className="pt-6 first:pt-0">
              <CommentItem
                comment={comment}
                onReply={handleReply}
              />
            </div>
          ))
        ) : (
          <p className="py-8 text-center text-sm text-surface-500">
            No comments yet. Be the first to share your thoughts!
          </p>
        )}
      </div>
    </section>
  );
}