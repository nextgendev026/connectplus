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
    <main className="grid min-h-[70vh] place-items-center px-6 py-16">
      <div className="surface-card w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/15">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="h-7 w-7 text-accent-strong"
            aria-hidden="true"
          >
            <path d="M2 8.82a15 15 0 0 1 20 0" />
            <path d="M5 12.86a10 10 0 0 1 14 0" />
            <path d="M8.5 16.43a5 5 0 0 1 7 0" />
            <line x1="3" y1="3" x2="21" y2="21" />
          </svg>
        </div>

        <h1 className="type-display text-surface-50">You&apos;re offline</h1>
        <p className="mt-2 text-sm leading-relaxed text-surface-400">
          connectPlus needs a connection for this page. Stories you&apos;ve already opened,
          plus the feed and radio you last loaded, are still available from your device.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="btn-gradient rounded-xl px-4 py-2.5 text-sm font-semibold"
          >
            Open saved feed
          </Link>
          <Link
            href="/radio"
            className="rounded-xl border border-surface-700 px-4 py-2.5 text-sm font-medium text-surface-200 transition-colors hover:border-brand-500/40 hover:text-surface-50"
          >
            Go to radio
          </Link>
        </div>

        <p className="type-caption mt-6 text-surface-500">
          Reconnect and pull to refresh to sync the latest stories.
        </p>
      </div>
    </main>
  );
}
