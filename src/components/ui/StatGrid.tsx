import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatItem {
  label: string;
  value: string | number;
  icon: LucideIcon;
}

/**
 * The row of live numbers a public page shows under its hero.
 *
 * Extracted from the About page so every page presents the platform's own
 * figures the same way — one card style, one label treatment, one place to
 * change all of them. The column count is a prop rather than a class the caller
 * writes, because Tailwind only ships classes it can see at build time; passing
 * a raw `lg:grid-cols-${n}` would silently drop out of the bundle.
 */
const COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
};

export function StatGrid({
  stats,
  columns,
  className,
}: {
  stats: readonly StatItem[];
  /** Desired desktop column count; the layout falls back to the closest safe value. */
  columns?: number;
  className?: string;
}) {
  if (stats.length === 0) return null;
  const cols = COLUMNS[columns ?? stats.length] ?? COLUMNS[Math.min(stats.length, 6)] ?? COLUMNS[3];

  return (
    <div className={cn("grid gap-3", cols, className)}>
      {stats.map((stat) => (
        <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <div className="flex items-center gap-2 mb-1">
            <stat.icon className="h-3.5 w-3.5 text-brand-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">
              {stat.label}
            </span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-white">{stat.value}</div>
        </div>
      ))}
    </div>
  );
}
