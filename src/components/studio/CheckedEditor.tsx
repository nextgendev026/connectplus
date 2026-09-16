"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WritingSuggestion } from "@/lib/writing-checks";

/**
 * The composer textarea with the writing checks drawn *on* the text.
 *
 * A textarea cannot hold styled ranges, so the marks come from a mirror layer:
 * an absolutely-positioned div over the textarea that renders the exact same
 * string with the exact same typography, but with the text transparent and only
 * the flagged spans decorated. The real textarea stays underneath and keeps
 * every native behaviour — caret, selection, undo, IME — while the reader sees
 * the text through the transparent mirror with wavy underlines on it.
 *
 * Two details make the alignment honest rather than approximately right:
 *
 *  1. The mirror repeats the textarea's *own* class list (padding, border,
 *     type scale, line-height, wrapping) instead of approximating it, because a
 *     one-pixel drift compounds down a long draft and the underline ends up
 *     under the wrong word.
 *  2. Its scroll position is copied from the textarea on every scroll, since
 *     the two boxes scroll independently.
 *
 * Only the flagged spans accept pointer events, so typing and text selection go
 * to the textarea while a click on a mark opens its fix card. The authoritative,
 * keyboard-accessible list of findings stays in the sidebar panel — the marks
 * are the at-a-glance layer, not the only way to reach a fix.
 */

const KIND_UNDERLINE: Record<WritingSuggestion["kind"], string> = {
  correctness: "decoration-red-400",
  clarity: "decoration-brand-400",
  engagement: "decoration-accent-violet",
  style: "decoration-surface-400",
};

const KIND_BADGE: Record<WritingSuggestion["kind"], string> = {
  correctness: "bg-red-500/15 text-red-300",
  clarity: "bg-brand-500/15 text-brand-300",
  engagement: "bg-accent-violet/15 text-accent-violet",
  style: "bg-surface-700/60 text-surface-300",
};

/** The textarea's text classes, reused verbatim by the mirror. */
/**
 * Both boxes reserve the same scrollbar gutter. Without it a scrolling textarea
 * narrows its content box by the scrollbar's width while the mirror's stays
 * full-width, the text wraps at a different column, and every mark below the
 * first wrap drifts. `scrollbar-gutter: stable` on both keeps the two columns
 * identical whether or not a scrollbar is showing.
 */
const TEXT_CLASSES =
  "px-4 sm:px-6 py-5 text-[15px] sm:text-base font-medium leading-[1.8] rounded-2xl border [scrollbar-gutter:stable]";

const TEXTAREA_CLASSES = cn(
  "w-full min-h-[50vh] bg-surface-800/80 border border-surface-700/50 rounded-2xl px-4 sm:px-6 py-5",
  "text-[15px] sm:text-base font-medium text-editor placeholder-editor placeholder:font-normal",
  "focus:outline-none focus:border-brand-500/40 focus:ring-1 focus:ring-brand-500/20 resize-none leading-[1.8]",
  "transition-all shadow-inner [scrollbar-gutter:stable]"
);

interface Segment {
  key: string;
  text: string;
  suggestion?: WritingSuggestion;
}

/**
 * Split the draft into plain runs and flagged runs.
 *
 * Overlaps are skipped rather than merged: the checker already de-duplicates,
 * and a defensive guard here means a malformed range can never make the mirror
 * render a different string from the one in the textarea.
 */
function segmentsOf(value: string, suggestions: WritingSuggestion[]): Segment[] {
  const usable = suggestions
    .filter((s) => s.start >= 0 && s.end <= value.length && s.start < s.end)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const segments: Segment[] = [];
  let cursor = 0;
  for (const s of usable) {
    if (s.start < cursor) continue;
    if (s.start > cursor) segments.push({ key: `t${cursor}`, text: value.slice(cursor, s.start) });
    segments.push({ key: s.id, text: value.slice(s.start, s.end), suggestion: s });
    cursor = s.end;
  }
  if (cursor < value.length) segments.push({ key: `t${cursor}`, text: value.slice(cursor) });
  return segments;
}

interface ActiveMark {
  suggestion: WritingSuggestion;
  top: number;
  left: number;
}

export function CheckedEditor({
  value,
  onChange,
  textareaRef,
  suggestions,
  onApply,
  onDismiss,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suggestions: WritingSuggestion[];
  onApply: (suggestion: WritingSuggestion) => void;
  onDismiss: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<ActiveMark | null>(null);

  const segments = useMemo(() => segmentsOf(value, suggestions), [value, suggestions]);

  /** Keep the mirror scrolled exactly where the textarea is. */
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, [textareaRef]);

  const close = useCallback(() => setActive(null), []);

  /**
   * Editing invalidates every mark's position, so an open card is closed on the
   * keystroke that moved the text rather than left pointing at a stale range.
   * Done in the event (not an effect) so the popover does not survive a render.
   */
  const handleChange = useCallback(
    (next: string) => {
      if (active) setActive(null);
      onChange(next);
    },
    [active, onChange]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openFor(event: React.MouseEvent<HTMLSpanElement>, suggestion: WritingSuggestion) {
    const mark = event.currentTarget;
    const wrap = wrapRef.current;
    if (!wrap) return;
    // `offsetParent` is the mirror (it is positioned), so the mark's offsets are
    // already relative to the editor box.
    const left = Math.max(8, Math.min(mark.offsetLeft, wrap.clientWidth - 280));
    setActive({ suggestion, top: mark.offsetTop + mark.offsetHeight + 6, left });
  }

  return (
    <div ref={wrapRef} className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        rows={20}
        disabled={disabled}
        spellCheck
        className={TEXTAREA_CLASSES}
      />

      {/* The mirror. Decorative: the sidebar panel is the accessible surface. */}
      <div
        ref={mirrorRef}
        data-checked-editor-mirror=""
        aria-hidden="true"
        className={cn(
          TEXT_CLASSES,
          "pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words",
          "border-transparent text-transparent"
        )}
      >
        {segments.map((seg) =>
          seg.suggestion ? (
            <span
              key={seg.key}
              data-check-id={seg.suggestion.id}
              onClick={(e) => openFor(e, seg.suggestion!)}
              className={cn(
                "pointer-events-auto cursor-pointer underline decoration-wavy underline-offset-[3px]",
                KIND_UNDERLINE[seg.suggestion.kind],
                active?.suggestion.id === seg.suggestion.id && "bg-surface-50/10"
              )}
            >
              {seg.text}
            </span>
          ) : (
            <span key={seg.key}>{seg.text}</span>
          )
        )}
      </div>

      {active ? (
        <>
          {/* Click-away layer, sitting under the card so the card stays usable. */}
          <div className="fixed inset-0 z-10" onClick={close} />
          <div
            role="dialog"
            aria-label={active.suggestion.message}
            className="absolute z-20 w-[17rem] rounded-xl border border-surface-700 bg-surface-900 p-3 shadow-xl"
            style={{ top: active.top, left: active.left }}
          >
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  "mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                  KIND_BADGE[active.suggestion.kind]
                )}
              >
                {active.suggestion.kind}
              </span>
              <p className="type-meta flex-1 leading-relaxed text-surface-200">
                {active.suggestion.message}
              </p>
              <button
                onClick={close}
                className="shrink-0 rounded p-0.5 text-surface-500 transition-colors hover:text-surface-200"
                aria-label="Close"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {active.suggestion.replacement !== null ? (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded bg-red-500/10 px-1.5 py-1 type-caption text-red-300 line-through">
                  {active.suggestion.original}
                </span>
                <span className="shrink-0 text-surface-600">→</span>
                <span className="min-w-0 flex-1 truncate rounded bg-emerald-500/10 px-1.5 py-1 type-caption text-emerald-300">
                  {active.suggestion.replacement}
                </span>
              </div>
            ) : null}

            <div className="mt-2.5 flex items-center gap-2">
              {active.suggestion.replacement !== null ? (
                <button
                  onClick={() => {
                    onApply(active.suggestion);
                    close();
                  }}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 type-caption font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20"
                >
                  <Check className="h-3 w-3" />
                  Apply fix
                </button>
              ) : null}
              <button
                onClick={() => {
                  onDismiss(active.suggestion.id);
                  close();
                }}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-700 px-2 py-1.5 type-caption text-surface-400 transition-colors hover:text-surface-100"
              >
                <X className="h-3 w-3" />
                Dismiss
              </button>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
