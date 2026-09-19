"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import {
  Mail,
  MailWarning,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  ArrowRight,
  Loader2,
} from "lucide-react";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [unverified, setUnverified] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setUnverified(false);

    if (!email.trim() || !password) {
      setError("Please enter both your email and password.");
      return;
    }

    setIsLoading(true);

    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password. Please try again.");
        setIsLoading(false);
        return;
      }

      // Signed in — check whether the email is confirmed yet.
      const fresh = await fetch("/api/auth/session").then((r) => r.json());
      const emailVerified = fresh?.user?.emailVerified as string | null | undefined;
      if (!emailVerified) {
        setIsLoading(false);
        setUnverified(true);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 text-surface-50 flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute inset-0 bg-mesh-gradient" />
      <div className="absolute top-20 -right-20 w-72 h-72 bg-brand-500/10 rounded-full blur-3xl" />
      <div className="absolute bottom-20 -left-20 w-72 h-72 bg-accent-cyan/5 rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <ConnectPlusMark className="w-10 h-10" />
          <span className="text-xl font-display font-bold">
            connect<span className="text-brand-400">Plus</span>
          </span>
        </Link>

        {/* Card */}
        <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-800/50 shadow-2xl p-8">
          <h1 className="text-2xl font-display font-bold text-surface-50 mb-1">
            Welcome back
          </h1>
          <p className="text-sm text-surface-400 mb-8">
            Sign in to continue creating and discovering stories.
          </p>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 mb-6 animate-slide-down">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">{error}</p>
            </div>
          )}

          {unverified && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 mb-6 animate-slide-down">
              <MailWarning className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs leading-relaxed">
                <p className="text-surface-300">
                  Welcome back! Your email isn&apos;t confirmed yet — publishing and
                  verified-writer applications are unlocked after you verify it.
                </p>
                <Link
                  href="/auth/verify-email"
                  className="mt-2 inline-flex items-center gap-1.5 font-medium text-amber-300 hover:text-amber-200 transition-colors"
                >
                  Go to verification <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-4 py-3 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-surface-400">
                  Password
                </label>
                {/* Points at the help page, which is real, rather than an href="#"
                    that looks like a reset flow and goes nowhere. There is no
                    self-service reset yet, and a dead control is worse than no
                    control — the reader clicks it, nothing happens, and they
                    conclude the sign-in is broken. */}
                <Link
                  href="/help"
                  className="inline-block py-1 text-[11px] text-brand-400 transition-colors hover:text-brand-300"
                >
                  Trouble signing in?
                </Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-10 py-3 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
                {/* 16×16 was the whole hit area of the password reveal — an icon
                    button on the one form every reader has to get through, and
                    the wrong size for a thumb. `p-1.5 -m-1` makes it 24×24 and
                    the negative margin leaves the input's padding untouched. */}
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-2 top-1/2 -m-1 -translate-y-1/2 rounded p-1.5 text-surface-600 transition-colors hover:text-surface-400"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-all",
                isLoading
                  ? "bg-brand-600 cursor-not-allowed opacity-70"
                  : "bg-brand-500 hover:bg-brand-600 shadow-glow"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Social sign-in — always visible; shows a not-configured state until Google credentials exist. */}
          <div className="mt-6">
            <OAuthButtons callbackUrl="/" />
          </div>

          {/* Footer */}
          <p className="mt-6 text-center text-xs text-surface-500">
            Don&apos;t have an account?{" "}
            <Link
              href="/auth/signup"
              className="inline-block px-1 py-2 font-medium text-brand-400 transition-colors hover:text-brand-300"
            >
              Sign up
            </Link>
          </p>
        </div>

        {/* Back link — `py-2` so the way out of the form is as easy to hit as
            the way in. It measured 16px tall, which on a phone meant a reader
            who wanted to leave the page had to aim. */}
        <Link
          href="/"
          className="mt-6 block py-2 text-center text-xs text-surface-500 transition-colors hover:text-surface-300"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
