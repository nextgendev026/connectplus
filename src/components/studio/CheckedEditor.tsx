"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Check, ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WritingSuggestion } from "@/lib/writing-checks";

/**
 * The composer textarea with the writing checks drawn *on* the text, the Brain
 * Pilot on a selection, and inline image drops.
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
 * to the textarea while a click on a mark opens its fix card.
 *
 * Three things were reworked for robustness:
 *
 *  • **The fix card is a bottom sheet on phones.** It used to be an absolutely
 *    positioned popover inside a 17rem box, which on a 360px screen hung off the
 *    edge of the viewport with its Apply button half off-screen — the single
 *    most common complaint about the inline assistant. Below the `sm` breakpoint
 *    it is now a full-width sheet pinned to the bottom of the viewport, where a
 *    thumb can actually reach it.
 *  • **The pilot bar appears under the editor on selection.** Textarea caret
 *    coordinates require measuring a mirror copy of the text, which drifts on
 *    mobile keyboards and IME composition. A sticky bar is exact, needs no
 *    measurement, and gives five comfortable tap targets.
 *  • **Dropping an image inserts it, rather than replacing the cover.** A drop
 *    on the body uploads the file and writes markdown at the caret.
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

export interface EditorRange {
  selectionStart: number;
  selectionEnd: number;
  cursor: number;
  hasSelection: boolean;
}

const EMPTY_RANGE: EditorRange = { selectionStart: 0, selectionEnd: 0, cursor: 0, hasSelection: false };

export function CheckedEditor({
  value,
  onChange,
  textareaRef,
  suggestions,
  onApply,
  onDismiss,
  onSelectionChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suggestions: WritingSuggestion[];
  onApply: (suggestion: WritingSuggestion) => void;
  onDismiss: (id: string) => void;
  /**
   * Reports the current selection.
   *
   * The assist widget is what acts on it now: the editor measures the selection
   * and hands it out, and the widget asks the pilot for an edit against those
   * same offsets, so an op can never be applied to the wrong words.
   */
  onSelectionChange?: (range: EditorRange) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState<ActiveMark | null>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const segments = useMemo(() => segmentsOf(value, suggestions), [value, suggestions]);

  /**
   * Which layout the fix card uses. Kept in state (not pure CSS) because the
   * card is positioned with inline `top`/`left` computed from the mark's offset,
   * and those coordinates are meaningless in the sheet layout.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 640px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /** Keep the mirror scrolled exactly where the textarea is. */
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.scrollTop = ta.scrollTop;
    mirror.scrollLeft = ta.scrollLeft;
  }, [textareaRef]);

  /** Read the caret/selection. Called on every meaningful selection event. */
  const readRange = useCallback((): EditorRange => {
    const ta = textareaRef.current;
    if (!ta) return EMPTY_RANGE;
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    return {
      selectionStart: start,
      selectionEnd: end,
      cursor: end,
      hasSelection: end > start,
    };
  }, [textareaRef]);

  const publishRange = useCallback(() => {
    // The selection is reported, not held: the widget owns what to do with it,
    // and a copy kept here would only ever be a second opinion about the caret.
    onSelectionChange?.(readRange());
  }, [readRange, onSelectionChange]);

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

  /**
   * Upload a dropped or pasted image and write its markdown at the caret.
   *
   * The insertion point is captured *before* the await: uploading takes a
   * second, and the caret the writer left behind is the one they meant. Reading
   * it afterwards would use wherever focus drifted to in the meantime.
   */
  const insertImages = useCallback(
    async (files: File[]) => {
      const images = files.filter((f) => f.type.startsWith("image/"));
      if (images.length === 0) return;

      const ta = textareaRef.current;
      const at = ta ? (ta.selectionEnd ?? value.length) : value.length;
      setUploading(true);
      setUploadError(null);

      const markdown: string[] = [];
      for (const file of images) {
        try {
          const form = new FormData();
          form.append("file", file);
          form.append("kind", "post");
          const res = await fetch("/api/upload", { method: "POST", body: form });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "Upload failed" }));
            throw new Error(err.error || "Upload failed");
          }
          const data = await res.json();
          const alt = file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim() || "image";
          markdown.push(`![${alt}](${data.url})`);
        } catch (err) {
          setUploadError(err instanceof Error ? err.message : "Upload failed");
        }
      }

      if (markdown.length > 0) {
        const block = markdown.join("\n\n");
        const before = value.slice(0, at);
        const prefix = before.length > 0 && !/\n\s*$/.test(before) ? "\n\n" : "";
        const next = `${before}${prefix}${block}\n\n${value.slice(at)}`;
        onChange(next);
        const caret = before.length + prefix.length + block.length + 2;
        requestAnimationFrame(() => {
          ta?.focus();
          ta?.setSelectionRange(caret, caret);
          publishRange();
        });
      }
      setUploading(false);
    },
    [onChange, publishRange, textareaRef, value]
  );

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    if (!event.dataTransfer?.files?.length) return;
    event.preventDefault();
    setDragging(false);
    void insertImages(Array.from(event.dataTransfer.files));
  }

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative rounded-2xl transition-shadow",
        dragging && "ring-2 ring-brand-500/60 ring-offset-2 ring-offset-surface-950"
      )}
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={handleDrop}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onScroll={syncScroll}
        onSelect={publishRange}
        onKeyUp={publishRange}
        onMouseUp={publishRange}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData?.files ?? []);
          if (files.some((f) => f.type.startsWith("image/"))) {
            e.preventDefault();
            void insertImages(files);
          }
        }}
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

      {dragging ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-dashed border-brand-500/70 bg-surface-950/80 backdrop-blur-sm">
          <span className="flex items-center gap-2 rounded-full bg-brand-500/15 px-4 py-2 text-xs font-semibold text-brand-200">
            <ImagePlus className="h-4 w-4" />
            Drop to insert into the story
          </span>
        </div>
      ) : null}

      {uploading ? (
        <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-surface-900/90 border border-surface-700 px-2.5 py-1 type-caption text-surface-300 backdrop-blur">
          <Loader2 className="h-3 w-3 animate-spin" />
          Optimising image…
        </div>
      ) : null}

      {uploadError ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
          <p className="type-caption flex-1 text-red-300">{uploadError}</p>
          <button onClick={() => setUploadError(null)} className="text-red-400 hover:text-red-300">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}


      {active ? (
        <>
          {/* Click-away layer, sitting under the card so the card stays usable. */}
          <div className="fixed inset-0 z-30" onClick={close} />
          <div
            role="dialog"
            aria-label={active.suggestion.message}
            className={cn(
              // Above the mobile bottom nav, which is z-40: a bottom sheet whose
              // lower half is a nav bar is a sheet the writer cannot use.
              "z-50 border border-surface-700 bg-surface-900 p-3 shadow-xl",
              // Phone: a bottom sheet. Desktop: the popover anchored to the mark.
              "fixed inset-x-0 bottom-0 rounded-t-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]",
              "sm:absolute sm:inset-x-auto sm:bottom-auto sm:w-[17rem] sm:rounded-xl sm:pb-3"
            )}
            style={isDesktop ? { top: active.top, left: active.left } : undefined}
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
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-2 type-caption font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 sm:py-1.5"
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-surface-700 px-2 py-2 type-caption text-surface-400 transition-colors hover:text-surface-100 sm:py-1.5"
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
