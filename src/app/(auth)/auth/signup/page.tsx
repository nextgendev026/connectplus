"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";
import {
  User,
  AtSign,
  Mail,
  Lock,
  Eye,
  EyeOff,
  AlertTriangle,
  ArrowRight,
  Loader2,
  Check,
} from "lucide-react";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [devVerifyUrl, setDevVerifyUrl] = useState<string | null>(null);

  const validateUsername = (value: string): boolean =>
    /^[a-zA-Z0-9_]{3,20}$/.test(value);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!username.trim()) {
      setError("Please choose a username.");
      return;
    }
    if (!validateUsername(username.trim())) {
      setError(
        "Username must be 3-20 characters and can only contain letters, numbers, and underscores."
      );
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!acceptedTerms) {
      setError("Please accept the terms of service to continue.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          email: email.trim(),
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || "Failed to create your account. Please try again.");
        setIsLoading(false);
        return;
      }

      const devVerifyUrl = data?.emailVerification?.devUrl as string | undefined;
      if (devVerifyUrl) {
        setDevVerifyUrl(devVerifyUrl);
        try {
          // Dev-mode handoff: surface the link on /auth/verify-email too, since
          // this page unmounts on redirect.
          localStorage.setItem("connectplus:dev-verify-url", devVerifyUrl);
        } catch {}
      }

      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Account created. Please sign in to continue.");
        router.push("/auth/signin");
        setIsLoading(false);
        return;
      }

      // New accounts land on the verification screen until their email is confirmed.
      router.push("/auth/verify-email?sent=1");
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

      <div className="relative w-full max-w-md py-10">
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
            Create your account
          </h1>
          <p className="text-sm text-surface-400 mb-8">
            Join the community of East African storytellers.
          </p>

          {error && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 mb-6 animate-slide-down">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">{error}</p>
            </div>
          )}

          {devVerifyUrl && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3 mb-6">
              <p className="text-xs text-emerald-300 leading-relaxed mb-1.5">
                Dev mode — no email provider configured. Verify with this link:
              </p>
              <div className="flex items-center gap-2">
                <a
                  href={devVerifyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-300 underline break-all hover:text-brand-200 transition-colors min-w-0"
                >
                  {devVerifyUrl}
                </a>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">
                Full name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Doe"
                  autoComplete="name"
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
              </div>
            </div>

            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">
                Username
              </label>
              <div className="relative">
                <AtSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="janedoe"
                  autoComplete="username"
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
              </div>
            </div>

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
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  autoComplete="new-password"
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-10 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-600 hover:text-surface-400 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-xs font-medium text-surface-400 mb-1.5">
                Confirm password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-600" />
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                  className="w-full rounded-xl bg-surface-800/50 border border-surface-700/50 pl-10 pr-10 py-2.5 text-sm text-surface-50 placeholder:text-surface-600 focus:outline-none focus:border-brand-500/50 focus:bg-surface-800/80 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-600 hover:text-surface-400 transition-colors"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Terms */}
            <label className="flex items-start gap-2.5 cursor-pointer group">
              <span className={cn(
                "w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 transition-all",
                acceptedTerms
                  ? "bg-brand-500 border-brand-500"
                  : "border-surface-600 group-hover:border-surface-500"
              )}>
                {acceptedTerms &&                     <Check className="w-3 h-3 text-white" />}
              </span>
              <input
                type="checkbox"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                className="hidden"
              />
              <p className="text-[11px] text-surface-500 leading-relaxed">
                I agree to the{" "}
                <a href="#" className="text-brand-400 hover:text-brand-300 transition-colors">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="text-brand-400 hover:text-brand-300 transition-colors">
                  Privacy Policy
                </a>
              </p>
            </label>

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
                  Creating account...
                </>
              ) : (
                <>
                  Sign Up
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="text-center text-xs text-surface-500 mt-6">
            Already have an account?{" "}
            <Link
              href="/auth/signin"
              className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
            >
              Sign in
            </Link>
          </p>
        </div>

        {/* Back link */}
        <Link
          href="/"
          className="block text-center text-xs text-surface-500 hover:text-surface-300 transition-colors mt-6"
        >
          ← Back to home
        </Link>
      </div>
    </div>
  );
}
