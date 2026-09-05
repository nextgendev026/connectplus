import Link from "next/link";
import { cn } from "@/lib/utils";

interface Tag {
  id: string;
  name: string;
  slug: string;
}

interface TagBadgeProps {
  tag: Tag;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  showLink?: boolean;
  className?: string;
}

const TAG_COLORS: Record<string, string> = {
  javascript: "from-yellow-500/20 to-yellow-600/10 text-yellow-400 ring-yellow-500/30",
  typescript: "from-blue-500/20 to-blue-600/10 text-blue-400 ring-blue-500/30",
  react: "from-cyan-500/20 to-cyan-600/10 text-cyan-400 ring-cyan-500/30",
  nextjs: "from-surface-400/20 to-surface-500/10 text-surface-200 ring-surface-500/30",
  nodejs: "from-green-500/20 to-green-600/10 text-green-400 ring-green-500/30",
  python: "from-blue-400/20 to-blue-500/10 text-blue-300 ring-blue-400/30",
  design: "from-pink-500/20 to-pink-600/10 text-pink-400 ring-pink-500/30",
  tutorial: "from-brand-500/20 to-brand-600/10 text-brand-400 ring-brand-500/30",
  devops: "from-orange-500/20 to-orange-600/10 text-orange-400 ring-orange-500/30",
  ai: "from-violet-500/20 to-violet-600/10 text-violet-400 ring-violet-500/30",
  webdev: "from-emerald-500/20 to-emerald-600/10 text-emerald-400 ring-emerald-500/30",
  css: "from-indigo-500/20 to-indigo-600/10 text-indigo-400 ring-indigo-500/30",
  api: "from-amber-500/20 to-amber-600/10 text-amber-400 ring-amber-500/30",
  database: "from-rose-500/20 to-rose-600/10 text-rose-400 ring-rose-500/30",
  security: "from-red-500/20 to-red-600/10 text-red-400 ring-red-500/30",
  mobile: "from-teal-500/20 to-teal-600/10 text-teal-400 ring-teal-500/30",
  backend: "from-slate-400/20 to-slate-500/10 text-slate-300 ring-slate-400/30",
  frontend: "from-brand-400/20 to-brand-500/10 text-brand-300 ring-brand-400/30",
};

const FALLBACK_COLORS = [
  "from-emerald-500/20 to-emerald-600/10 text-emerald-400 ring-emerald-500/30",
  "from-cyan-500/20 to-cyan-600/10 text-cyan-400 ring-cyan-500/30",
  "from-violet-500/20 to-violet-600/10 text-violet-400 ring-violet-500/30",
  "from-amber-500/20 to-amber-600/10 text-amber-400 ring-amber-500/30",
  "from-rose-500/20 to-rose-600/10 text-rose-400 ring-rose-500/30",
  "from-indigo-500/20 to-indigo-600/10 text-indigo-400 ring-indigo-500/30",
  "from-teal-500/20 to-teal-600/10 text-teal-400 ring-teal-500/30",
  "from-pink-500/20 to-pink-600/10 text-pink-400 ring-pink-500/30",
];

function getTagColor(slug: string): string {
  const key = slug.toLowerCase();
  if (TAG_COLORS[key]) return TAG_COLORS[key];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length] ?? "";
}

const SIZE_CLASSES = {
  sm: "px-2 py-0.5 text-[11px]",
  md: "px-3 py-1 text-xs",
  lg: "px-4 py-1.5 text-sm",
};

export function TagBadge({
  tag,
  size = "md",
  active = false,
  showLink = true,
  className,
}: TagBadgeProps) {
  const colorClasses = getTagColor(tag.slug);

  const badge = (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-medium ring-1 backdrop-blur-sm",
        "transition-all duration-200",
        SIZE_CLASSES[size],
        colorClasses,
        active && "ring-brand-400 bg-brand-500/20 text-brand-300",
        showLink &&
          "cursor-pointer hover:ring-brand-400/50 hover:bg-brand-500/10 hover:text-brand-300",
        !showLink && "cursor-default",
        className
      )}
    >
      {tag.name}
    </span>
  );

  if (showLink) {
    return (
      <Link href={`/tags/${tag.slug}`} className="inline-flex">
        {badge}
      </Link>
    );
  }

  return badge;
}
