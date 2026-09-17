import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { diagnoseGoogleSignIn } from "@/lib/oauth-diagnostic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google-check — is Google sign-in actually wired up here?
 *
 * Admin-only, because it is a configuration readout rather than user data, and
 * because it makes an outbound request to Google. The answer is identical for
 * every caller on a given origin, and `diagnoseGoogleSignIn` memoises it, so
 * refreshing this does not hammer Google.
 *
 * Exists so the answer does not require reproducing a failed login in a browser:
 * `curl -b <admin cookie> /api/auth/google-check` returns the status, the exact
 * redirect URI and Google's own explanation.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  // The external origin, not the internal one: behind Vercel and the Cloudflare
  // edge, `request.url` is the origin the proxy talked to, and the redirect URI
  // Google validates is the one the browser was on.
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const origin = (process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? `${proto}://${host}`).replace(/\/+$/, "");

  const diagnosis = await diagnoseGoogleSignIn(origin);
  return NextResponse.json(diagnosis);
}
