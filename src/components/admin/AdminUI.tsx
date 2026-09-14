import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Shared chrome for the admin console.
 *
 * The console grew page by page, so each one answered the same three questions
 * differently: where does the title go, what does a stat tile look like, what
 * colour is a "warning". The result read as sixteen different apps stapled
 * together — and because several pages also carried light-first colour classes,
 * they disagreed about what light mode even is.
 *
 * These primitives answer those questions once. They are deliberately plain
 * server components: no hooks, no client boundary, so a page can drop them in
 * without becoming interactive.
 *
 * All colour comes from the `surface-*` / semantic tokens, which FLIP between
 * themes (see the token blocks in globals.css). That is why nothing here has a
 * `dark:` variant — a class that needs one is a class that is wrong in one of
 * the two modes.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Page frame
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The frame every console page sits in: one title block, one actions slot, and
 * a consistent measure. `wide` opts a page out of the default reading width for
 * genuinely wide surfaces like the payments ledger.
 */
export function AdminPage({
  title,
  description,
  icon: Icon,
  actions,
  wide,
  children,
}: {
  title: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full", wide ? "max-w-none" : "max-w-6xl")}>
      <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-500/25 bg-brand-500/10 text-accent-strong sm:grid">
              <Icon className="h-5 w-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-surface-50 sm:text-xl">{title}</h1>
            {description ? (
              <p className="mt-0.5 text-[13px] leading-snug text-surface-400">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-4 sm:space-y-5">{children}</div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Panels
   ──────────────────────────────────────────────────────────────────────────── */

const TONE_RING = {
  neutral: "border-surface-800",
  brand: "border-brand-500/25",
  positive: "border-emerald-500/25",
  warning: "border-amber-500/25",
  danger: "border-red-500/25",
} as const;

export type AdminTone = keyof typeof TONE_RING;

/** A titled surface. The console's unit of layout. */
export function AdminPanel({
  title,
  description,
  icon: Icon,
  action,
  tone = "neutral",
  flush,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  description?: string;
  icon?: ComponentType<{ className?: string }>;
  action?: ReactNode;
  tone?: AdminTone;
  /** Drop the body padding — for a panel whose body is a table or list. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("surface-card overflow-hidden", TONE_RING[tone], className)}>
      {title || action ? (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-800 p-3.5 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-accent-strong" /> : null}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-surface-100">{title}</h2>
              {description ? <p className="text-[11px] text-surface-400">{description}</p> : null}
            </div>
          </div>
          {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      <div className={cn(flush ? "" : "p-3.5 sm:p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Stats
   ──────────────────────────────────────────────────────────────────────────── */

const STAT_TONE = {
  brand: "border-brand-500/25 bg-brand-500/10 text-accent-strong",
  positive: "border-emerald-500/25 bg-emerald-500/10 text-positive-strong",
  warning: "border-amber-500/25 bg-amber-500/10 text-warning-strong",
  danger: "border-red-500/25 bg-red-500/10 text-danger-strong",
  info: "border-sky-500/25 bg-sky-500/10 text-info-strong",
  neutral: "border-surface-700 bg-surface-800 text-surface-200",
} as const;

/**
 * A single figure with a label.
 *
 * The trend line is a `sub`, not a coloured sentence buried in the card, so a
 * row of tiles keeps one baseline and the numbers line up when scanned.
 */
export function AdminStat({
  icon: Icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon?: ComponentType<{ className?: string }>;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: keyof typeof STAT_TONE;
}) {
  return (
    <div className="surface-card p-3.5">
      <div className="flex items-center gap-3">
        {Icon ? (
          <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border", STAT_TONE[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-xl font-bold leading-tight tracking-tight text-surface-50">{value}</p>
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-surface-400">{label}</p>
        </div>
      </div>
      {sub ? <div className="mt-2 border-t border-surface-800 pt-2 text-[11px] text-surface-400">{sub}</div> : null}
    </div>
  );
}

/** A responsive grid for `AdminStat`s. */
export function AdminStatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Badges and notices
   ──────────────────────────────────────────────────────────────────────────── */

const BADGE_TONE = {
  neutral: "border-surface-700 bg-surface-800 text-surface-300",
  brand: "border-brand-500/30 bg-brand-500/10 text-accent-strong",
  positive: "border-emerald-500/30 bg-emerald-500/10 text-positive-strong",
  warning: "border-amber-500/30 bg-amber-500/10 text-warning-strong",
  danger: "border-red-500/30 bg-red-500/10 text-danger-strong",
  info: "border-sky-500/30 bg-sky-500/10 text-info-strong",
} as const;

export function AdminBadge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof BADGE_TONE;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        BADGE_TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Inline feedback — the console's one way of saying "this failed". */
export function AdminNotice({
  tone = "danger",
  children,
}: {
  tone?: keyof typeof BADGE_TONE;
  children: ReactNode;
}) {
  return (
    <p className={cn("rounded-xl border px-3 py-2 text-[13px] font-medium", BADGE_TONE[tone])} role="status">
      {children}
    </p>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Empty states
   ──────────────────────────────────────────────────────────────────────────── */

export function AdminEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {Icon ? (
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-surface-700 bg-surface-800 text-surface-400">
          <Icon className="h-5 w-5" />
        </span>
      ) : null}
      <p className="text-sm font-semibold text-surface-100">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-surface-400">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Controls
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Form controls, as class strings.
 *
 * A control that is only styled where it happens to be used is how the console
 * ended up with three different input heights. These are the console's inputs;
 * `focus-visible` (not `focus`) is used so a mouse click does not leave a ring
 * behind, which is what the rest of the app does.
 */
export const adminInput =
  "w-full rounded-xl border border-surface-700 bg-surface-900 px-3 py-2.5 text-sm text-surface-50 outline-none transition placeholder:text-surface-500 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50";

export const adminBtnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:opacity-50";

export const adminBtnGhost =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-surface-700 bg-surface-900 px-3.5 py-2.5 text-sm font-medium text-surface-200 transition hover:border-surface-700 hover:text-surface-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 disabled:opacity-50";

export const adminBtnDanger =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm font-semibold text-danger-strong transition hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-50";

/** Segmented control — one selected out of a few. Wraps on a narrow screen. */
export function AdminSegmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-surface-800 bg-surface-900 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-semibold transition",
            value === option.value
              ? "bg-brand-500 text-white shadow-sm"
              : "text-surface-400 hover:bg-surface-800 hover:text-surface-100"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
