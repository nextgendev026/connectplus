"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Loader2, Info } from "lucide-react";

/**
 * Social sign-in buttons.
 *
 * Provider availability is read from NextAuth's own `/api/auth/providers`
 * endpoint so the button state tracks server config exactly — add
 * GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET and it becomes live; remove them and
 * it falls back to the not-configured state. No env values are ever shipped to
 * the browser.
 *
 * The button is always rendered (never hidden). Hiding it entirely made a
 * half-configured deployment look like the feature had never been built; a
 * disabled button with an honest explanation is both discoverable and useful.
 */
export function OAuthButtons({ callbackUrl = "/" }: { callbackUrl?: string }) {
  const [providers, setProviders] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  /** Honour ?callbackUrl= on the page — someone bounced here from a gated action
   *  ("sign in to like/bookmark/publish") should land back where they were, not
   *  on the homepage. Resolved at click time from window rather than via
   *  useSearchParams, so no page needs a Suspense boundary for this. */
  function targetCallbackUrl(): string {
    try {
      return new URLSearchParams(window.location.search).get("callbackUrl") || callbackUrl;
    } catch {
      return callbackUrl;
    }
  }

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

  const checking = providers === null;
  const googleReady = Boolean(providers?.google);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-surface-800" />
        <span className="text-[10px] uppercase tracking-wider text-surface-500">or</span>
        <span className="h-px flex-1 bg-surface-800" />
      </div>

      <button
        type="button"
        disabled={pending !== null || checking || !googleReady}
        aria-disabled={!googleReady}
        title={googleReady ? "Continue with Google" : "Google sign-in is not configured yet"}
        onClick={() => {
          if (!googleReady) return;
          setPending("google");
          void signIn("google", { callbackUrl: targetCallbackUrl() });
        }}
        className="w-full flex items-center justify-center gap-2.5 rounded-xl border border-surface-700/60 bg-surface-800/40 py-3 text-sm font-medium text-surface-100 hover:bg-surface-800 hover:border-surface-600 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {checking || pending === "google" ? (
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
        {checking ? "Checking Google sign-in…" : "Continue with Google"}
      </button>

      {!checking && !googleReady ? (
        <div className="flex items-start gap-2 rounded-xl border border-surface-700/60 bg-surface-800/40 px-3 py-2.5 text-[11px] leading-relaxed text-surface-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
          <p>
            Google sign-in isn&apos;t configured on this deployment yet. You can still use your email
            and password above. Admins: add <code className="rounded bg-surface-900 px-1">GOOGLE_CLIENT_ID</code> and{" "}
            <code className="rounded bg-surface-900 px-1">GOOGLE_CLIENT_SECRET</code> to switch it on — see{" "}
            <span className="text-surface-300">Admin → Integrations</span> for the exact redirect URI.
          </p>
        </div>
      ) : null}
    </div>
  );
}
