"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Send, Heart, Loader2 } from "lucide-react";
import { timeAgo } from "@/lib/utils";

export interface CommentReply {
  id: string;
  content: string;
  createdAt: string | Date;
  author: { id: string; name: string | null; username: string; avatar?: string | null };
  _count?: { likes: number };
}

export interface CommentItem {
  id: string;
  content: string;
  createdAt: string | Date;
  author: { id: string; name: string | null; username: string; avatar?: string | null };
  _count?: { likes: number };
  replies: CommentReply[];
}

interface CommentsSectionProps {
  postId: string;
  initialComments: CommentItem[];
}

export function CommentsSection({ postId, initialComments }: CommentsSectionProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLTextAreaElement>(null);

  const refresh = () => {
    fetch(`/api/comments?postId=${postId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.comments)) setComments(data.comments);
      })
      .catch(() => {});
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    if (status !== "authenticated" || !session?.user) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, content: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to post comment");
      setText("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="mt-12">
      <h3 className="text-lg font-bold text-surface-50 mb-6">
        Comments ({comments.length})
      </h3>

      <form onSubmit={submit} className="mb-8">
        <textarea
          ref={formRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Share your thoughts..."
          className="w-full rounded-xl border border-surface-700 bg-surface-800/50 p-4 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
          rows={3}
        />
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={posting || !text.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors disabled:opacity-50"
          >
            {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Post Comment
          </button>
        </div>
      </form>

      <div className="space-y-6">
        {comments.map((comment) => (
          <div key={comment.id} className="flex gap-3">
            <Link href={`/profile/${comment.author.username}`} className="shrink-0">
              <div className="h-8 w-8 flex-shrink-0 rounded-full bg-surface-700 flex items-center justify-center text-xs font-bold text-surface-50 overflow-hidden">
                {comment.author.avatar ? (
                  <img src={comment.author.avatar} alt="" className="w-full h-full object-cover" />
                ) : (
                  comment.author.name?.charAt(0) ?? "?"
                )}
              </div>
            </Link>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Link href={`/profile/${comment.author.username}`} className="text-sm font-medium text-surface-50 hover:text-brand-400">
                  {comment.author.name ?? "Anonymous"}
                </Link>
                <span className="text-xs text-surface-500">@{comment.author.username}</span>
                <span className="text-xs text-surface-600">{timeAgo(comment.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-surface-300 whitespace-pre-wrap break-words">{comment.content}</p>
              <div className="mt-1.5 flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-xs text-surface-500">
                  <Heart className="h-3 w-3" />
                  {comment._count?.likes ?? 0}
                </span>
                <ReplyButton postId={postId} parentId={comment.id} onPosted={refresh} />
              </div>

              {comment.replies.length > 0 && (
                <div className="mt-4 ml-0 space-y-4 border-l border-surface-800 pl-4">
                  {comment.replies.map((reply) => (
                    <div key={reply.id} className="flex gap-3">
                      <Link href={`/profile/${reply.author.username}`} className="shrink-0">
                        <div className="h-6 w-6 flex-shrink-0 rounded-full bg-surface-700 flex items-center justify-center text-[10px] font-bold text-surface-50 overflow-hidden">
                          {reply.author.avatar ? (
                            <img src={reply.author.avatar} alt="" className="w-full h-full object-cover" />
                          ) : (
                            reply.author.name?.charAt(0) ?? "?"
                          )}
                        </div>
                      </Link>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/profile/${reply.author.username}`} className="text-sm font-medium text-surface-50 hover:text-brand-400">
                            {reply.author.name ?? "Anonymous"}
                          </Link>
                          <span className="text-xs text-surface-500">@{reply.author.username}</span>
                          <span className="text-xs text-surface-600">{timeAgo(reply.createdAt)}</span>
                        </div>
                        <p className="mt-1 text-sm text-surface-300 whitespace-pre-wrap break-words">{reply.content}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {comments.length === 0 && (
          <p className="text-sm text-surface-500">Be the first to comment.</p>
        )}
      </div>
    </div>
  );
}

function ReplyButton({
  postId,
  parentId,
  onPosted,
}: {
  postId: string;
  parentId: string;
  onPosted: () => void;
}) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    if (status !== "authenticated" || !session?.user) {
      router.push(`/auth/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setPosting(true);
    setError("");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, parentId, content: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to reply");
      setText("");
      setOpen(false);
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reply");
    } finally {
      setPosting(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs text-surface-500 hover:text-surface-50 transition-colors"
      >
        Reply
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply..."
            className="w-full rounded-lg border border-surface-700 bg-surface-800/50 p-3 text-sm text-surface-50 placeholder-surface-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
            rows={2}
          />
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
          <div className="mt-1.5 flex justify-end">
            <button
              type="submit"
              disabled={posting || !text.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-600 transition-colors disabled:opacity-50"
            >
              {posting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Reply
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
