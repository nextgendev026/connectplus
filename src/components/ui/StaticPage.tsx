import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Section {
  heading: string;
  body: string;
  items?: string[];
}

interface StaticPageProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  sections: Section[];
  updatedAt?: string;
  className?: string;
}

export function StaticPage({
  icon,
  title,
  subtitle,
  sections,
  updatedAt,
  className,
}: StaticPageProps) {
  return (
    <div className="min-h-screen bg-surface-950">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-mesh-gradient" />
        <div className="absolute inset-0 bg-gradient-to-b from-surface-950 via-surface-950/40 to-surface-950" />
        <div className="absolute top-0 right-0 w-full h-full pointer-events-none overflow-hidden">
          <div className="absolute top-[10%] right-[8%] w-72 h-72 bg-brand-500/6 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-[15%] left-[5%] w-48 h-48 bg-accent-cyan/6 rounded-full blur-3xl animate-float-delayed" />
        </div>

        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 py-16 md:py-24">
          <nav className="flex items-center gap-1.5 text-xs text-surface-500 mb-8">
            <Link href="/" className="hover:text-brand-400 transition-colors">
              Home
            </Link>
            <ChevronRight className="w-3 h-3" />
            <span className="text-surface-400">{title}</span>
          </nav>

          <div className="inline-flex items-center gap-2 rounded-full bg-brand-500/10 border border-brand-500/20 px-4 py-1.5 mb-6 animate-fade-in-up">
            {icon}
            <span className="text-xs font-medium text-brand-400">
              connectPlus
            </span>
          </div>

          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-tight text-surface-50 mb-4 animate-fade-in-up animation-delay-100">
            {title}
          </h1>
          <p className="text-base sm:text-lg text-surface-400 leading-relaxed max-w-2xl animate-fade-in-up animation-delay-200">
            {subtitle}
          </p>
        </div>
      </div>

      <div
        className={cn(
          "max-w-4xl mx-auto px-4 sm:px-6 pb-20 -mt-4",
          className
        )}
      >
        <div className="rounded-3xl border border-surface-800/60 bg-surface-900/50 p-6 sm:p-10 shadow-card-hover">
          {sections.map((section, i) => (
            <section
              key={section.heading}
              className={cn(i > 0 && "mt-10 border-t border-surface-800/60 pt-10")}
            >
              <h2 className="font-display text-xl sm:text-2xl font-bold text-surface-50 mb-3 flex items-center gap-2.5">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-brand-400" />
                </span>
                {section.heading}
              </h2>
              <div className="prose prose-sm sm:prose-base max-w-none">
                <p>{section.body}</p>
                {section.items && section.items.length > 0 && (
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}

          {updatedAt && (
            <p className="mt-10 pt-6 border-t border-surface-800/60 text-xs text-surface-500">
              Last updated: {updatedAt}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}