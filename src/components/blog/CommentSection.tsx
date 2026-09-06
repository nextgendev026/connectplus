"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
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

interface Comment {
  id: string;
  content: string;
  createdAt: string;
  author: CommentAuthor;
  likes: number;
  likedByUser: boolean;
  replies: Comment[];
}

interface CommentSectionProps {
  postId: string;
  className?: string;
}

const MOCK_COMMENTS: Comment[] = [
  {
    id: "c1",
    content:
      "This is an excellent deep dive into the architecture! The way you broke down the component hierarchy really helped me understand the trade-offs better.",
    createdAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    author: {
      id: "u1",
      name: "Amara Osei",
      username: "amara_codes",
      avatar: null,
    },
    likes: 12,
    likedByUser: false,
    replies: [
      {
        id: "c1r1",
        content:
          "Agreed! The diagrams were particularly helpful. Would love to see a follow-up on the state management approach.",
        createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
        author: {
          id: "u2",
          name: "Kwame Mensah",
          username: "kwame_dev",
          avatar: null,
        },
        likes: 5,
        likedByUser: true,
        replies: [],
      },
      {
        id: "c1r2",
        content:
          "I've been working on something similar. The caching layer you described is exactly what I needed.",
        createdAt: new Date(Date.now() - 1000 * 60 * 15).toISOString(),
        author: {
          id: "u3",
          name: "Fatima Hassan",
          username: "fatima_builds",
          avatar: null,
        },
        likes: 3,
        likedByUser: false,
        replies: [],
      },
    ],
  },
  {
    id: "c2",
    content:
      "One question — how do you handle the edge case where the cache invalidation race condition occurs during concurrent writes? I ran into this in production last week.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    author: {
      id: "u4",
      name: "David Njoroge",
      username: "davidn",
      avatar: null,
    },
    likes: 8,
    likedByUser: false,
    replies: [],
  },
  {
    id: "c3",
    content:
      "Bookmarked this for our team's next sprint planning. The performance benchmarks are really convincing.",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    author: {
      id: "u5",
      name: "Zuri Kimani",
      username: "zuri_tech",
      avatar: null,
    },
    likes: 4,
    likedByUser: false,
    replies: [
      {
        id: "c3r1",
        content:
          "Same here! Our lead shared this in the engineering channel. Great resource.",
        createdAt: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
        author: {
          id: "u6",
          name: "Aisha Patel",
          username: "aisha_dev",
          avatar: null,
        },
        likes: 2,
        likedByUser: false,
        replies: [],
      },
    ],
  },
];

function CommentItem({
  comment,
  depth = 0,
  onReply,
}: {
  comment: Comment;
  depth?: number;
  onReply: (parentId: string) => void;
}) {
  const [liked, setLiked] = useState(comment.likedByUser);
  const [likeCount, setLikeCount] = useState(comment.likes);
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
            src={comment.author.avatar || "/avatars/default.png"}
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

export function CommentSection({ postId: _postId, className }: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>(MOCK_COMMENTS);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"newest" | "popular">("newest");

  const totalComments = comments.reduce(
    (acc, c) => acc + 1 + c.replies.length,
    0
  );

  const handleSubmit = useCallback(() => {
    if (!newComment.trim()) return;

    const comment: Comment = {
      id: `c-${Date.now()}`,
      content: newComment.trim(),
      createdAt: new Date().toISOString(),
      author: {
        id: "current-user",
        name: "You",
        username: "current_user",
        avatar: null,
      },
      likes: 0,
      likedByUser: false,
      replies: [],
    };

    if (replyingTo) {
      setComments((prev) =>
        prev.map((c) =>
          c.id === replyingTo
            ? { ...c, replies: [...c.replies, comment] }
            : c
        )
      );
    } else {
      setComments((prev) => [comment, ...prev]);
    }

    setNewComment("");
    setReplyingTo(null);
  }, [newComment, replyingTo]);

  const handleReply = useCallback((parentId: string) => {
    setReplyingTo(parentId);
  }, []);

  const sortedComments = [...comments].sort((a, b) => {
    if (sortBy === "popular") return b.likes - a.likes;
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
          <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-surface-700">
            <Image
              src="/avatars/default.png"
              alt="Your avatar"
              fill
              className="object-cover"
            />
          </div>
          <div className="flex-1">
            <div className="relative">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder={
                  replyingTo ? "Write a reply..." : "Share your thoughts..."
                }
                rows={3}
                className={cn(
                  "w-full resize-none rounded-xl border border-surface-700/50 bg-surface-800/50 px-4 py-3 text-sm text-surface-50 placeholder-surface-500",
                  "transition-all focus:border-brand-500/50 focus:outline-none focus:ring-1 focus:ring-brand-500/30",
                  "placeholder-surface-600"
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
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-surface-600">
                Press Ctrl+Enter to submit
              </span>
              <button
                onClick={handleSubmit}
                disabled={!newComment.trim()}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  newComment.trim()
                    ? "bg-brand-600 text-white hover:bg-brand-500 shadow-glow"
                    : "bg-surface-800 text-surface-500 cursor-not-allowed"
                )}
              >
                <Send className="h-4 w-4" />
                {replyingTo ? "Reply" : "Comment"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-6 divide-y divide-surface-800/60">
        {sortedComments.map((comment) => (
          <div key={comment.id} className="pt-6 first:pt-0">
            <CommentItem
              comment={comment}
              onReply={handleReply}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
