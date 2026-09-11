"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";

/**
 * Social sign-in buttons.
 *
 * Provider availability is read from NextAuth's own `/api/auth/providers`
 * endpoint so the buttons track server config exactly — add GOOGLE_CLIENT_ID +
 * GOOGLE_CLIENT_SECRET and Google appears; remove them and it disappears. No
 * env values are ever shipped to the browser.
 */
export function OAuthButtons({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/providers")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (alive) setProviders(data ?? {});
      })
      .catch(() => {
        if (alive) setProviders({});
      });
    return () => {
      alive = false;
    };
  }, []);

  // Until we know, render nothing rather than flashing a button that may not exist.
  if (!providers) return null;

  const googleReady = Boolean(providers.google);
  if (!googleReady) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-surface-800" />
        <span className="text-[10px] uppercase tracking-wider text-surface-500">or</span>
        <span className="h-px flex-1 bg-surface-800" />
      </div>

      <button
        type="button"
        disabled={pending !== null}
        onClick={() => {
          setPending("google");
          void signIn("google", { callbackUrl });
        }}
        className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-surface-700/60 bg-surface-800/40 py-3 text-sm font-medium text-surface-100 hover:bg-surface-800 hover:border-surface-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {pending === "google" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
            />
          </svg>
        )}
        Continue with Google
      </button>
    </div>
  );
}
