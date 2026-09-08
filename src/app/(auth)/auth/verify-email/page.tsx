"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";
import {
  MailCheck,
  Mail,
  Loader2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type VerifyState =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "done" }
  | { kind: "error"; message: string; expired?: boolean };

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-surface-950 text-surface-50 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
        </div>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const params = useSearchParams();
  const token = params.get("token");
  const sent = params.get("sent") === "1";
  const { data: session, update } = useSession();
  const [state, setState] = useState<VerifyState>({ kind: "idle" });
  const [resending, setResending] = useState(false);
  const [resentAt, setResentAt] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const ran = useRef(false);

  // Dev-mode only: the register/resend APIs print a verification URL when no
  // email provider is configured — surface it so the flow stays testable.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("connectplus:dev-verify-url");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- dev-only localStorage read on mount
      if (stored) setDevLink(stored);
    } catch {}
  }, []);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    setState({ kind: "verifying" });
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setState({ kind: "done" });
          try {
            await update(); // refresh session so emailVerified flips client-side
          } catch {}
        } else {
          setState({
            kind: "error",
            message: data?.error || "Verification failed. Please try again.",
            expired: res.status === 410,
          });
        }
      })
      .catch(() => setState({ kind: "error", message: "Network error. Please try again." }));
  }, [token, update]);

  const resend = async () => {
    setResending(true);
    try {
      const res = await fetch("/api/auth/resend-verification", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data?.emailVerification?.devUrl) {
          setResentAt(data.emailVerification.devUrl);
        } else {
          setResentAt("sent");
        }
      } else {
        setState({ kind: "error", message: data?.error || "Couldn't resend the email." });
      }
    } catch {
      setState({ kind: "error", message: "Network error. Please try again." });
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 text-surface-50 flex items-center justify-center px-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-mesh-gradient" />
      <div className="absolute top-20 -right-20 w-72 h-72 bg-brand-500/10 rounded-full blur-3xl" />

      <div className="relative w-full max-w-md py-10">
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <ConnectPlusMark className="w-10 h-10" />
          <span className="text-xl font-display font-bold">
            connect<span className="text-brand-400">Plus</span>
          </span>
        </Link>

        <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-800/50 shadow-2xl p-8">
          {state.kind === "verifying" ? (
            <div className="flex flex-col items-center py-6 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-brand-400" />
              <p className="mt-4 text-sm text-surface-400">Confirming your email…</p>
            </div>
          ) : state.kind === "done" ? (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30">
                <MailCheck className="h-7 w-7 text-positive-strong" />
              </div>
              <h1 className="mt-5 text-xl font-bold">Email verified!</h1>
              <p className="mt-2 text-sm text-surface-400 leading-relaxed">
                Your email is confirmed. You can now publish stories and apply to
                become a verified writer.
              </p>
              <div className="mt-6 flex w-full flex-col gap-2">
                <Link
                  href="/settings"
                  className="btn-gradient flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white"
                >
                  Continue to Settings <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href={session?.user ? "/studio" : "/"}
                  className="rounded-xl border border-surface-700 bg-surface-800 py-3 text-center text-sm font-medium text-surface-300 hover:text-surface-50 transition-colors"
                >
                  {session?.user ? "Start writing" : "Back to home"}
                </Link>
              </div>
            </div>
          ) : state.kind === "error" ? (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 border border-red-500/30">
                <AlertTriangle className="h-7 w-7 text-danger-strong" />
              </div>
              <h1 className="mt-5 text-xl font-bold">Couldn&apos;t verify that link</h1>
              <p className="mt-2 text-sm text-surface-400 leading-relaxed">{state.message}</p>
              <button
                onClick={resend}
                disabled={resending}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-600 shadow-glow transition-colors disabled:opacity-70"
              >
                {resending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Resend verification email
              </button>
              <Link
                href="/auth/signin"
                className="mt-3 text-xs text-surface-500 hover:text-surface-300 transition-colors"
              >
                Sign in instead
              </Link>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/15 border border-brand-500/30">
                <Mail className="h-7 w-7 text-accent-strong" />
              </div>
              <h1 className="mt-5 text-xl font-bold">
                {sent ? "Check your inbox" : "Verify your email"}
              </h1>
              <p className="mt-2 text-sm text-surface-400 leading-relaxed">
                We&apos;ve sent a confirmation link to your email. Tap it to verify
                your account and unlock publishing.
              </p>
              {resentAt && (
                <div className="mt-4 w-full rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-left">
                  {resentAt === "sent" ? (
                    <p className="type-caption text-emerald-300">Verification email sent — check your inbox.</p>
                  ) : (
                    <p className="type-caption text-emerald-300">
                      Dev mode — verification link:{" "}
                      <a href={resentAt} className="underline break-all">{resentAt}</a>
                    </p>
                  )}
                </div>
              )}
              {!resentAt && devLink && !token && (
                <div className="mt-4 w-full rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-left">
                  <p className="type-caption text-emerald-300">
                    Dev mode — your verification link:{" "}
                    <a href={devLink} className="underline break-all">{devLink}</a>
                  </p>
                </div>
              )}
              <button
                onClick={resend}
                disabled={resending}
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl border border-surface-700 bg-surface-800 py-3 text-sm font-medium text-surface-200 hover:bg-surface-700 transition-colors disabled:opacity-70"
              >
                {resending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {resentAt ? "Resend again" : "I didn't get the email"}
              </button>
              <Link
                href={session?.user ? "/" : "/auth/signin"}
                className={cn("mt-3 text-xs text-surface-500 hover:text-surface-300 transition-colors")}
              >
                {session?.user ? "Skip for now" : "Sign in instead"}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}