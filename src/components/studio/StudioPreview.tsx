"use client";

import { useMemo } from "react";
import Image from "next/image";
import { Clock, BookOpen, Tag as TagIcon } from "lucide-react";
import { StyledContent } from "@/components/ui/StyledContent";

interface StudioPreviewProps {
  title: string;
  content: string;
  excerpt: string;
  coverImage: string | null;
  categoryName: string;
  tags: string[];
}

export function StudioPreview({
  title,
  content,
  excerpt,
  coverImage,
  categoryName,
  tags,
}: StudioPreviewProps) {
  const wordCount = useMemo(
    () => content.split(/\s+/).filter(Boolean).length,
    [content]
  );
  const readTime = Math.max(1, Math.ceil(wordCount / 200));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-surface-700/70 bg-gradient-to-b from-surface-900/80 to-surface-900/40 min-h-[60vh]">
      {/* Ambient glow */}
      <div className="pointer-events-none absolute -top-20 -right-20 h-52 w-52 rounded-full bg-brand-500/10 blur-3xl" />

      <article className="p-6 sm:p-8 lg:p-10">
        {/* Title */}
        <h1 className="text-3xl sm:text-4xl font-display font-extrabold text-surface-50 mb-4 tracking-tight leading-tight">
          {title || (
            <span className="text-surface-600 italic">Untitled Story</span>
          )}
        </h1>

        {/* Meta strip */}
        <div className="flex items-center gap-3 text-xs text-surface-500 mb-6 flex-wrap">
          {categoryName && (
            <span className="inline-flex items-center rounded-full bg-gradient-to-r from-brand-500/20 to-accent-coral/15 px-2.5 py-0.5 text-accent-strong border border-brand-500/25">
              {categoryName}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {readTime} min read
          </span>
          <span className="flex items-center gap-1">
            <BookOpen className="w-3 h-3" />
            {wordCount} words
          </span>
        </div>

        {/* Excerpt */}
        {excerpt && (
          <p className="text-sm text-surface-400 italic mb-6 pb-6 border-b border-surface-800/60 leading-relaxed">
            {excerpt}
          </p>
        )}

        {/* Cover image */}
        {coverImage && (
          <div className="rounded-xl overflow-hidden mb-8 ring-1 ring-surface-700/60">
            <Image
              src={coverImage}
              alt="Cover"
              width={1024}
              height={576}
              className="w-full h-48 sm:h-64 lg:h-80 object-cover"
              unoptimized
            />
          </div>
        )}

        {/* Rendered markdown content */}
        {content.trim() ? (
          <StyledContent content={content} />
        ) : (
          <p className="text-surface-600 italic">
            Start writing to see your story come to life…
          </p>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-8 pt-6 border-t border-surface-800/60">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-brand-500/15 to-accent-coral/10 px-3 py-1 text-xs font-medium text-accent-strong border border-brand-500/20"
              >
                <TagIcon className="w-3 h-3" />
                {tag}
              </span>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
