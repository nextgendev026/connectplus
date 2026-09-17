import Link from "next/link";
import { headers } from "next/headers";
import ConnectPlusMark from "@/components/ui/ConnectPlusMark";
import { AlertTriangle, ArrowLeft, LifeBuoy, Info } from "lucide-react";
import { diagnoseGoogleSignIn } from "@/lib/oauth-diagnostic";
import { cn } from "@/lib/utils";

interface SearchParams {
  error?: string;
  error_description?: string;
}

const errorMessages: Record<string, string> = {
  // Deliberately specific: "contact support" told the reader nothing, and the
  // reader is usually the person who can fix this in the Google console.
  Configuration:
    "Google refused the sign-in request — almost always because the app's redirect URI is not on the OAuth client's Authorized redirect URIs list. The exact URI to add is below.",
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
  const { error: errorCode, error_description: errorDescription } = (await searchParams) ?? {};
  const code = errorCode ?? "Default";
  const message = errorMessages[code] ?? errorMessages.Default;

  // "There is a problem with the server configuration" is the same sentence for a
  // dozen different faults. When one of those faults is an OAuth allow-list
  // mismatch, this page can name it and print the exact fix — so it asks Google
  // rather than guessing. Failures here never block the page.
  const host = (await headers()).get("host") ?? "";
  const proto = (await headers()).get("x-forwarded-proto") ?? "https";
  const diagnosis =
    code === "Configuration" || code === "OAuthCallback" || code === "OAuthSignin"
      ? await diagnoseGoogleSignIn(`${proto}://${host}`).catch(() => null)
      : null;

  return (
    <div className="min-h-screen bg-surface-950 text-surface-50 flex items-center justify-center px-6 relative overflow-hidden">
      {/* Background accents */}
      <div className="absolute inset-0 bg-mesh-gradient" />
      <div className="absolute top-20 -right-20 w-72 h-72 bg-red-500/5 rounded-full blur-3xl" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="flex items-center justify-center gap-2 mb-8">
          <ConnectPlusMark className="w-10 h-10" />
          <span className="text-xl font-display font-bold text-surface-50">
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

          {diagnosis ? (
            <div
              className={cn(
                "mb-6 rounded-xl border p-4 text-left",
                diagnosis.status === "ok"
                  ? "border-emerald-500/25 bg-emerald-500/5"
                  : "border-amber-500/25 bg-amber-500/5"
              )}
            >
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-surface-300">
                <Info className="h-3.5 w-3.5" />
                Google sign-in check
              </p>
              <p className="mt-2 text-xs leading-relaxed text-surface-300">{diagnosis.hint}</p>
              <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-surface-500">
                Redirect URI
              </p>
              <code className="mt-1 block break-all rounded-lg bg-surface-950/70 px-2.5 py-2 font-mono text-[11px] text-surface-200">
                {diagnosis.register}
              </code>
              {diagnosis.detail ? (
                <p className="mt-3 font-mono text-[10px] leading-relaxed text-surface-500">
                  {diagnosis.detail.slice(0, 240)}
                </p>
              ) : null}
            </div>
          ) : null}

          {errorDescription ? (
            <p className="mb-5 break-words font-mono text-[10px] leading-relaxed text-surface-500">
              {errorDescription.slice(0, 240)}
            </p>
          ) : null}

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
