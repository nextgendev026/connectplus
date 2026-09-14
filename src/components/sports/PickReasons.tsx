"use client";

import { Activity, AlertTriangle, ChevronDown, Gauge, Percent, Shield, Target, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PickInsight, PickReason } from "@/lib/pick-insights";

/**
 * The icon each reason carries.
 *
 * Icons are read before words when a reader scans a board, so they have to mean
 * the same thing everywhere they appear: goals we expect, likelihood, price,
 * the bookmakers' view, form, and how this kind of pick has gone before.
 */
export const REASON_ICONS: Record<PickReason["icon"], typeof Target> = {
  goals: Target,
  chance: Gauge,
  value: Percent,
  bookies: Shield,
  form: Activity,
  record: Trophy,
};

/**
 * "Why this pick" — the reasons behind a prediction.
 *
 * This is the part of a tip that makes it judgeable: a percentage on its own
 * tells a reader nothing about whether to believe it. The reasons come first,
 * the caveat sits with them rather than in a footnote, and the model's own
 * audit trail is translated and tucked behind a disclosure for whoever wants
 * the working.
 */
export function PickReasons({
  insight,
  className,
  compact = false,
  limit,
  showNote = true,
}: {
  insight: PickInsight;
  className?: string;
  /** Fewer reasons, no caution block — for a secondary market on a card. */
  compact?: boolean;
  /**
   * Cap on how many reasons render here.
   *
   * A card that prints all four reasons and its caveat is a card whose bottom
   * half is a wall of small print; three is where the eye stops reading and
   * starts skimming. The rest are not dropped — the card puts them behind its
   * own "full working" disclosure, along with the model's note.
   */
  limit?: number;
  /**
   * Whether the model's audit trail renders as its own disclosure.
   *
   * A card hosting its own "full working" panel sets this false so the reader
   * gets one disclosure to open rather than two nested ones.
   */
  showNote?: boolean;
}) {
  const reasons = compact ? insight.reasons.slice(0, 2) : insight.reasons.slice(0, limit ?? insight.reasons.length);

  return (
    <div className={cn("min-w-0", className)}>
      {!compact ? (
        <>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-surface-500">Why this pick</p>
          <p className="mt-1 text-xs leading-relaxed text-surface-300">{insight.summary}</p>
        </>
      ) : null}

      <ul className={cn("space-y-2", compact ? "mt-0" : "mt-2.5")}>
        {reasons.map((reason, index) => {
          const Icon = REASON_ICONS[reason.icon];
          return (
            <li
              key={reason.label}
              className="flex gap-2.5 motion-safe:animate-rise"
              style={{ animationDelay: `${60 + index * 60}ms` }}
            >
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-surface-800/80 text-emerald-300">
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold text-surface-200">{reason.label}</span>
                <span className="block text-[11px] leading-relaxed text-surface-400">{reason.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>

      {!compact ? (
        <p className="mt-2.5 flex gap-2 rounded-lg bg-amber-500/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-amber-200/90">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>{insight.caution}</span>
        </p>
      ) : null}

      {showNote && insight.note ? (
        <details className="mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-surface-500 transition hover:text-surface-300">
            <ChevronDown className="h-3 w-3" />
            Model notes
          </summary>
          <p className="mt-1.5 text-[11px] leading-relaxed text-surface-400">{insight.note}</p>
        </details>
      ) : null}
    </div>
  );
}
