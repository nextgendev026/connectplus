"use client";

import { Check, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PilotEditReview, PilotField } from "@/lib/brain-pilot";
import { PILOT_QUICK_ACTIONS, type PilotAction } from "@/lib/brain-pilot";

/**
 * The pilot's proposed edits, shown before any of them lands.
 *
 * Rendering the diff rather than the result is the whole point. An assistant
 * that writes straight into a draft asks the writer to notice a change they did
 * not make; this asks them to read one sentence about it and say yes. Each edit
 * is decided on its own, because the useful case is rarely all-or-nothing — a
 * model that fixes six things and misreads the seventh should cost one click,
 * not a rewrite.
 *
 * It sits directly under the editor rather than in the sidebar for the same
 * reason the pilot bar does: on a phone the sidebar is behind the Tools drawer,
 * and an approval prompt the writer cannot see is one they will approve blind.
 */

const FIELD_LABEL: Record<PilotField, string> = {
  content: "Body",
  title: "Headline",
  excerpt: "Excerpt",
  tags: "Tags",
};

/** Actions that are not on the quick-action rail still need a name here. */
const EXTRA_LABELS: Partial<Record<PilotAction, string>> = {
  article: "Full article",
  headline: "Headline",
  excerpt: "Excerpt",
  tags: "Tags",
};

function actionLabel(action: PilotAction): string {
  return PILOT_QUICK_ACTIONS.find((a) => a.id === action)?.label ?? EXTRA_LABELS[action] ?? "Pilot";
}

/** One changed run, rendered so removals and additions read as a single phrase. */
function DiffRun({ segments }: { segments: PilotEditReview["segments"] }) {
  return (
    <p className="type-meta leading-relaxed whitespace-pre-wrap break-words text-surface-200">
      {segments.map((seg, i) =>
        seg.type === "same" ? (
          <span key={i} className="text-surface-500">
            {seg.text}
          </span>
        ) : seg.type === "del" ? (
          <span key={i} className="rounded bg-red-500/10 text-red-300/90 line-through decoration-red-400/60">
            {seg.text}
          </span>
        ) : (
          <span key={i} className="rounded bg-emerald-500/15 font-medium text-emerald-200">
            {seg.text}
          </span>
        )
      )}
    </p>
  );
}

/**
 * Past this many characters a word-diff stops being reviewable.
 *
 * A whole article staged as a diff is thousands of spans describing a document
 * the writer will read once anyway, and it is slow to render on a phone. Above
 * the cap the panel switches to word counts and the opening of the new text,
 * which is what a writer actually checks before accepting a redraft.
 */
const BULK_DIFF_CHARS = 1_600;

function isBulk(review: PilotEditReview): boolean {
  const total = review.segments.reduce((sum, s) => sum + s.text.length, 0);
  return review.after.length > BULK_DIFF_CHARS || total > BULK_DIFF_CHARS;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function BulkChange({ review }: { review: PilotEditReview }) {
  const opening = review.after.trim().split(/\n{2,}/).slice(0, 2).join("\n\n");
  return (
    <div className="space-y-1.5">
      <p className="type-caption text-surface-400">
        {words(review.before)} words → <span className="font-semibold text-surface-200">{words(review.after)} words</span>
        {review.before.trim() ? " · the current text is replaced" : " · the draft was empty"}
      </p>
      <p className="rounded-lg border border-surface-800 bg-surface-950/60 p-2 type-meta leading-relaxed text-surface-300 whitespace-pre-wrap break-words">
        {opening}
        {review.after.trim().length > opening.length ? "…" : ""}
      </p>
    </div>
  );
}

/** A field whose value is set rather than rewritten: before → after, inline. */
function FieldChange({ review }: { review: PilotEditReview }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {review.before ? (
        <>
          <span className="min-w-0 flex-1 truncate rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 type-caption text-red-300/90 line-through">
            {review.before}
          </span>
          <span className="shrink-0 text-surface-600">→</span>
        </>
      ) : null}
      <span className="min-w-0 flex-1 truncate rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 type-caption text-emerald-200">
        {review.after}
      </span>
    </div>
  );
}

export function PilotReview({
  action,
  reply,
  reviews,
  busy = false,
  onAccept,
  onReject,
  onAcceptAll,
  onRejectAll,
  onDismiss,
}: {
  action: PilotAction;
  reply: string;
  reviews: PilotEditReview[];
  busy?: boolean;
  onAccept: (index: number) => void;
  onReject: (index: number) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onDismiss: () => void;
}) {
  const usable = reviews.filter((r) => !r.impossible);
  const usableCount = usable.length;

  return (
    <section
      aria-label="Proposed edits"
      className="rounded-2xl border border-accent-violet/30 bg-surface-900/70 p-3 shadow-card"
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-accent-violet">
          <Sparkles className="h-3.5 w-3.5" />
          {actionLabel(action)} — review before it lands
        </span>
        <span className="type-caption text-surface-500">
          {usableCount === 0
            ? "nothing to apply"
            : `${usableCount} proposed edit${usableCount === 1 ? "" : "s"}`}
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Discard every proposed edit"
          className="ml-auto rounded p-1 text-surface-500 transition-colors hover:text-surface-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      {reply ? <p className="mt-2 type-meta text-surface-400">{reply}</p> : null}

      {reviews.length === 0 ? (
        <p className="mt-2 type-meta text-surface-500">
          The pilot found nothing worth changing. Your draft stands.
        </p>
      ) : null}

      <ul className="mt-2.5 space-y-2">
        {reviews.map((review) => (
          <li
            key={review.index}
            className={cn(
              "rounded-xl border p-2.5",
              review.impossible
                ? "border-surface-800 bg-surface-950/40 opacity-60"
                : "border-surface-800 bg-surface-950/60"
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="type-caption font-semibold text-surface-200">{review.label}</span>
              <span className="rounded border border-surface-700 bg-surface-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-surface-400">
                {FIELD_LABEL[review.field]}
              </span>
              {review.impossible ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-warning-strong">
                  cannot apply
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy || review.impossible}
                  onClick={() => onReject(review.index)}
                  className="rounded-lg border border-surface-700 px-2 py-1 type-caption font-medium text-surface-400 transition-colors hover:text-surface-100 disabled:opacity-40"
                >
                  Discard
                </button>
                <button
                  type="button"
                  disabled={busy || review.impossible}
                  onClick={() => onAccept(review.index)}
                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 type-caption font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  <Check className="h-3 w-3" />
                  Keep
                </button>
              </div>
            </div>

            <div className="mt-2">
              {review.field === "content" && review.segments.length > 0 ? (
                isBulk(review) ? <BulkChange review={review} /> : <DiffRun segments={review.segments} />
              ) : (
                <FieldChange review={review} />
              )}
            </div>

            {review.impossible ? (
              <p className="mt-1.5 type-caption text-surface-500">
                Nothing in the draft matches what this edit expects — usually because the passage it was
                written against has already changed.
              </p>
            ) : null}
          </li>
        ))}
      </ul>

      {usableCount > 1 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onAcceptAll}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-accent-violet to-brand-500 px-3 py-2 type-meta font-semibold text-white shadow-glow transition hover:scale-[1.01] disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Keep all {usableCount}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onRejectAll}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-surface-700 px-3 py-2 type-meta font-medium text-surface-300 transition hover:text-surface-50 disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Discard all
          </button>
        </div>
      ) : null}
    </section>
  );
}
