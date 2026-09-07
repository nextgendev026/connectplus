"use client";

import { useId, useMemo } from "react";
import { cn } from "@/lib/utils";
import { processContent, type ProcessedContent } from "@/lib/content-processor";

interface StyledContentProps {
  content: string;
  className?: string;
  /** Compact mode drops the big-first-letter and hero image framing. */
  compact?: boolean;
}

/**
 * Renders post content (RSS HTML or composer markdown/plain text) as clean,
 * styled rich text. The body is processed + sanitized server/client-side, then
 * injected into a prose container whose CSS (globals.css .prose) styles it.
 */
export function StyledContent({ content, className, compact = false }: StyledContentProps) {
  const rawId = useId();
  const cssId = `rc-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  const processed = useMemo<ProcessedContent>(() => processContent(content), [content]);

  if (!processed.html) return null;

  return (
    <div
      id={cssId}
      className={cn(
        "connectplus-prose prose prose-lg max-w-none",
        compact && "connectplus-prose-compact",
        className
      )}
      dangerouslySetInnerHTML={{ __html: processed.html }}
    />
  );
}
