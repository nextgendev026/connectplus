"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { X, Loader2, BadgeCheck, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

interface UserItem {
  id: string;
  name: string | null;
  username: string;
  avatar: string | null;
  bio: string | null;
  isVerified: boolean;
  node: string | null;
  _count?: { posts: number; followingLinks?: number; followersLinks?: number };
  followedAt?: string;
}

interface PostItem {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  coverImage: string | null;
  createdAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  authorName?: string;
}

interface ListResponse {
  items: UserItem[] | PostItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type ModalTab = "followers" | "following" | "bookmarks";

export function ProfileListModal({
  open,
  onClose,
  username,
  tab,
  total,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  tab: ModalTab;
  total: number;
}) {
  const [items, setItems] = useState<(UserItem | PostItem)[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const observerRef = useRef<HTMLDivElement | null>(null);
  const fetchedRef = useRef(false);

  // Reset on open/tab change
  useEffect(() => {
    if (open) {
      setItems([]);
      setPage(1);
      setHasMore(true);
      fetchedRef.current = false;
    }
  }, [open, tab]);

  // Fetch page
  useEffect(() => {
    if (!open || page < 1) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/profile/${username}?tab=${tab}&page=${page}`
        );
        if (!res.ok) return;
        const data: ListResponse = await res.json();
        if (cancelled) return;

        setItems((prev) => {
          const existing = new Set(prev.map((i: any) => i.id));
          const newItems = (data.items as any[]).filter(
            (i) => !existing.has(i.id)
          );
          return [...prev, ...newItems];
        });
        setHasMore(page < data.totalPages);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, username, tab, page]);

  // Infinite scroll observer
  useEffect(() => {
    const el = observerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && hasMore && !loading) {
          setPage((p) => p + 1);
        }
      },
      { rootMargin: "200px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loading]);

  const title =
    tab === "followers"
      ? "Followers"
      : tab === "following"
        ? "Following"
        : "Saved Stories";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg max-h-[80vh] rounded-t-3xl border border-surface-800/70 bg-surface-900 shadow-2xl sm:rounded-3xl overflow-hidden flex flex-col animate-fade-in-up">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-800/70 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-surface-50">{title}</h2>
            <p className="text-xs text-surface-500">
              {total.toLocaleString()} {total === 1 ? "person" : "people"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-surface-400 hover:text-surface-200 hover:bg-surface-800 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {tab === "bookmarks"
            ? renderBookmarkItems(items as PostItem[])
            : renderUserItems(items as UserItem[], tab)}

          {loading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-brand-400" />
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center py-10 text-center">
              <p className="text-sm text-surface-400">
                {tab === "followers"
                  ? "No followers yet"
                  : tab === "following"
                    ? "Not following anyone yet"
                    : "No saved stories yet"}
              </p>
            </div>
          )}

          {/* Infinite scroll sentinel */}
          <div ref={observerRef} className="h-1" />
        </div>
      </div>
    </div>
  );
}

function renderUserItems(items: UserItem[], tab: ModalTab) {
  return items.map((user) => {
    const initials = (user.name ?? user.username)
      .split(/\s+/)
      .map((w) => w.charAt(0))
      .slice(0, 2)
      .join("")
      .toUpperCase();

    return (
      <Link
        key={user.id}
        href={`/profile/${user.username}`}
        className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-800/50"
      >
        {user.avatar ? (
          <Image
            src={user.avatar}
            alt={user.name ?? user.username}
            width={44}
            height={44}
            className="h-11 w-11 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-surface-700 to-surface-800 text-sm font-bold text-surface-300">
            {initials}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-semibold text-surface-50">
              {user.name ?? user.username}
            </p>
            {user.isVerified && (
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-brand-400" />
            )}
          </div>
          <p className="truncate text-xs text-surface-500">@{user.username}</p>
          {user.bio && (
            <p className="mt-0.5 truncate text-[11px] text-surface-400">
              {user.bio}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {user._count && (
            <span className="text-[10px] font-medium text-surface-500">
              {user._count.posts} stories
            </span>
          )}
          {user.node && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-surface-500">
              <MapPin className="h-2.5 w-2.5" />
              {user.node}
            </span>
          )}
        </div>
      </Link>
    );
  });
}

function renderBookmarkItems(items: PostItem[]) {
  return items.map((post) => (
    <Link
      key={post.id}
      href={`/article/${post.slug}`}
      className="flex items-center gap-3 rounded-xl p-3 transition-colors hover:bg-surface-800/50"
    >
      <div className="min-w-0 flex-1">
        <p className="line-clamp-1 text-sm font-semibold text-surface-50">
          {post.title}
        </p>
        {post.excerpt && (
          <p className="mt-0.5 line-clamp-1 text-xs text-surface-400">
            {post.excerpt}
          </p>
        )}
        <p className="mt-1 text-[10px] text-surface-500">
          {post.authorName && `${post.authorName} · `}
          {new Date(post.createdAt).toLocaleDateString("en-GB", {
            month: "short",
            year: "numeric",
          })}
        </p>
      </div>
      <div className="shrink-0 text-[10px] text-surface-500">
        {post.viewCount.toLocaleString()} views
      </div>
    </Link>
  ));
}
