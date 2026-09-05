"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import SavannaMark from "@/components/ui/SavannaMark";
import {
  Mail,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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
          <SavannaMark className="w-10 h-10" />
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
                <a href="#" className="text-[10px] text-brand-400 hover:text-brand-300 transition-colors">
                  Forgot password?
                </a>
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

          {/* Footer */}
          <p className="text-center text-xs text-surface-500 mt-6">
            Don&apos;t have an account?{" "}
            <Link
              href="/auth/signup"
              className="text-brand-400 hover:text-brand-300 font-medium transition-colors"
            >
              Sign up
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
