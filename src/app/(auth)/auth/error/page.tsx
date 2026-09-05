import Link from "next/link";
import { Zap, AlertTriangle, ArrowLeft, LifeBuoy } from "lucide-react";

interface SearchParams {
  error?: string;
}

const errorMessages: Record<string, string> = {
  Configuration: "There is a problem with the server configuration. Please contact support.",
  AccessDenied: "You do not have permission to sign in. Please contact the administrator.",
  Verification: "The sign-in link you used is invalid or has expired. Please request a new one.",
  OAuthSignin: "There was an error with the sign-in provider. Please try again.",
  OAuthCallback: "There was an error during the sign-in callback. Please try again.",
  OAuthCreateAccount:
    "There was an error creating your account with the sign-in provider. Please try again.",
  EmailCreateAccount:
    "There was an error creating your account with the email provider. Please try again.",
  Callback: "An unexpected error occurred during sign-in. Please try again.",
  OAuthAccountNotLinked:
    "This email is already linked to another sign-in method. Please use that method instead.",
  EmailSignin: "There was an error sending the sign-in email. Please try again.",
  CredentialsSignin: "Sign-in failed. Check your credentials and try again.",
  SessionRequired: "Please sign in to access this page.",
  Default: "An unexpected error occurred. Please try again.",
};

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { error: errorCode } = await searchParams ?? {};
  const code = errorCode ?? "Default";
  const message = errorMessages[code] ?? errorMessages.Default;

  return (
    <div className="min-h-screen bg-surface-950 text-surface-50 flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute inset-0 bg-mesh-gradient" />
      <div className="absolute top-20 -right-20 w-72 h-72 bg-red-500/5 rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-display font-bold">
            connect<span className="text-brand-400">Plus</span>
          </span>
        </Link>

        {/* Error Card */}
        <div className="rounded-2xl bg-surface-900/80 backdrop-blur-sm border border-surface-800/50 shadow-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-7 h-7 text-red-400" />
          </div>

          <h1 className="text-xl font-display font-bold text-surface-50 mb-2">
            Authentication Error
          </h1>

          <p className="text-sm text-surface-400 leading-relaxed mb-2">
            {message}
          </p>
          {code !== "Default" && (
            <p className="text-[10px] text-surface-600 mb-6 font-mono">
              Error code: {code}
            </p>
          )}

          <div className="space-y-3">
            <Link
              href="/auth/signin"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-600 transition-colors shadow-glow"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Sign In
            </Link>

            <Link
              href="/"
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-surface-700 px-6 py-3 text-sm font-medium text-surface-300 hover:bg-surface-800/50 hover:border-surface-600 transition-colors"
            >
              <LifeBuoy className="w-4 h-4" />
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
