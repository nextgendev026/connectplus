import type { Metadata } from "next";
import Link from "next/link";

// The service worker precaches this route, so it must be a static artifact —
// never a server render that needs the database while the device is offline.
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Offline",
  description: "You're offline — saved stories are still available.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="relative grid min-h-[80vh] place-items-center overflow-hidden px-6 py-16">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-brand-glow" />
      <div className="pointer-events-none absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/8 blur-3xl" />

      <div className="relative w-full max-w-md text-center">
        {/* Animated mark */}
        <div className="relative mx-auto mb-6 h-20 w-20">
          <div className="absolute -inset-3 rounded-full bg-gradient-to-br from-brand-500/15 via-accent-amber/10 to-accent-coral/15 blur-xl animate-pulse" style={{ animationDuration: "3s" }} />
          <div className="relative flex h-full w-full items-center justify-center rounded-full bg-surface-900/80 border border-surface-800/60 shadow-glow">
            {/* Offline icon — wifi-off */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-9 w-9 text-accent-strong"
              aria-hidden="true"
            >
              <path d="M2 8.82a15 15 0 0 1 20 0" />
              <path d="M5 12.86a10 10 0 0 1 14 0" />
              <path d="M8.5 16.43a5 5 0 0 1 7 0" />
              <line x1="3" y1="3" x2="21" y2="21" />
            </svg>
          </div>
        </div>

        <h1 className="text-xl font-bold text-surface-50">You&apos;re offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-surface-400">
          connectPlus needs a connection for this page. Stories you&apos;ve already
          opened, plus the feed and radio you last loaded, are still available
          from your device.
        </p>

        {/* Saved content hint */}
        <div className="mt-5 rounded-xl border border-surface-800/60 bg-surface-900/40 p-3">
          <p className="text-[11px] font-medium uppercase tracking-wider text-surface-500">
            Available offline
          </p>
          <div className="mt-2 flex items-center justify-center gap-4 text-xs text-surface-400">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Saved stories
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
              Cached feed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Radio
            </span>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="group relative overflow-hidden rounded-xl bg-gradient-to-r from-brand-500 to-accent-amber px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition-all hover:shadow-glow-lg hover:scale-[1.02] active:scale-[0.98]"
          >
            <span className="relative z-10">Open saved feed</span>
            <div className="absolute inset-0 bg-gradient-to-r from-brand-400 to-accent-amber opacity-0 transition-opacity group-hover:opacity-100" />
          </Link>
          <Link
            href="/radio"
            className="rounded-xl border border-surface-700 bg-surface-900/50 px-5 py-2.5 text-sm font-medium text-surface-200 transition-all hover:border-brand-500/40 hover:bg-surface-800/60 hover:text-surface-50"
          >
            Go to radio
          </Link>
        </div>

        <p className="mt-6 text-[11px] text-surface-500">
          Reconnect and pull to refresh to sync the latest stories.
        </p>
      </div>
    </main>
  );
}
