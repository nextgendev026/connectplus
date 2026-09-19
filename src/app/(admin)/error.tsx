"use client";

/**
 * Admin error boundary.
 *
 * The admin console is where operators work when something is already broken,
 * so an error here should not require them to dig through DevTools. This
 * boundary shows the error message, the digest (for matching against Sentry),
 * and a retry button — all in the admin's own dark theme.
 */

import { useEffect } from "react";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[AdminError]", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <h1 className="text-xl font-bold text-surface-50">Admin panel error</h1>
        <p className="mt-2 text-sm text-surface-400">
          This panel hit an error. The data may be stale or unavailable.
        </p>
        <p className="mt-1 rounded-lg bg-surface-800 px-3 py-1.5 text-xs text-surface-500">
          {error.message}
        </p>
        {error.digest && (
          <p className="mt-1 text-[11px] text-surface-500">Digest: {error.digest}</p>
        )}
        <button
          onClick={() => reset()}
          className="mt-4 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
        >
          Reload panel
        </button>
      </div>
    </div>
  );
}
