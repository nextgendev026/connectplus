"use client";

/**
 * The root error boundary.
 *
 * When something throws during rendering — a bad prop, a network failure inside
 * a component, a race condition that slips past the type checker — React unmounts
 * the tree rather than showing a half-rendered page. This component catches that
 * failure and shows a recoverable UI: the error message (for the developer), a
 * retry button (for the user), and a link home (for when retry does not help).
 *
 * Without this boundary, any render error in any page shows Chrome's ugly
 * "This page isn't working" screen — which is the single fastest way to lose a
 * reader.
 */

import { useEffect } from "react";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to the console so it appears in browser DevTools even
    // when Sentry is not configured.
    console.error("[GlobalError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold text-surface-50">Something went wrong</h1>
        <p className="mt-3 text-sm text-surface-400">
          The page hit an unexpected error. You can try reloading, or head back to
          the homepage.
        </p>
        {error.digest && (
          <p className="mt-2 rounded-lg bg-surface-800 px-3 py-1.5 text-xs text-surface-500">
            Error: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            onClick={() => reset()}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-lg border border-surface-700 px-4 py-2 text-sm font-medium text-surface-300 hover:text-surface-100"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
