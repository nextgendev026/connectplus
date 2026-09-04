"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { PostWithAuthor } from "@/types";
import { PostCard } from "./PostCard";

interface BentoGridProps {
  posts: PostWithAuthor[];
  className?: string;
}

export function BentoGrid({ posts, className }: BentoGridProps) {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(entry.target.getAttribute("data-index"));
            if (!isNaN(index)) {
              setVisibleItems((prev) => new Set(prev).add(index));
            }
          }
        });
      },
      { threshold: 0.1, rootMargin: "50px" }
    );

    const items = containerRef.current?.querySelectorAll("[data-index]");
    items?.forEach((item) => observer.observe(item));

    return () => observer.disconnect();
  }, [posts]);

  if (posts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-surface-800/50">
          <svg
            className="h-10 w-10 text-surface-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
            />
          </svg>
        </div>
        <h3 className="font-display text-lg font-semibold text-surface-300">
          No posts yet
        </h3>
        <p className="mt-1 text-sm text-surface-500">
          Be the first to share something with the community.
        </p>
      </div>
    );
  }

  const sorted = [...posts].sort((a, b) => {
    if (a.featured && !b.featured) return -1;
    if (!a.featured && b.featured) return 1;
    return 0;
  });

  return (
    <div
      ref={containerRef}
      className={cn(
        "grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3",
        className
      )}
    >
      {sorted.map((post, index) => {
        const isFeatured = post.featured && index === 0;
        const isVisible = visibleItems.has(index);

        return (
          <div
            key={post.id}
            data-index={index}
            className={cn(
          isFeatured && "md:col-span-2 lg:col-span-2",
              "transition-all duration-700 ease-out",
              isVisible
                ? "translate-y-0 opacity-100"
                : "translate-y-6 opacity-0"
            )}
            style={{ transitionDelay: `${(index % 6) * 80}ms` }}
          >
            <PostCard
              post={post}
              variant={isFeatured ? "featured" : "default"}
            />
          </div>
        );
      })}
    </div>
  );
}
