import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runStaleJobs, type SafetyNetScope } from "@/lib/cron-schedule";
import { hasSharedSecret } from "@/lib/shared-secret";
import { createLogger } from "@/lib/logger";

/**
 * The catch-up sweep: run whatever the heartbeat ledger says is overdue.
 *
 * `scope=essential` is the Vercel safety net — the once-a-day pass over the
 * jobs whose absence a reader can see.
 *
 * `scope=all` is the Cloudflare tick's pass over the WHOLE registry. It exists
 * because four jobs had never run at all: they are `essential: false`, so this
 * sweep skipped them by design, and Inngest — their only other scheduler — was
 * not delivering. Judging every job against its own cadence makes the registry
 * self-healing: a job runs because it is overdue, not because someone remembered
 * to add a cron trigger for it.
 *
 *   GET /api/cron/safety-net               stale essentials only
 *   GET /api/cron/safety-net?scope=all     every registry job that is overdue
 *   GET /api/cron/safety-net?force=1       run the selected scope now, due or not
 *
 * Authorization: Bearer <CRON_SECRET> | x-cron-secret | ?key=/?secret= | admin.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The fallback may run the RSS poll and the publishing pass inline.
export const maxDuration = 300;

const log = createLogger("cron-safety-net");

async function authorize(request: NextRequest): Promise<boolean> {
  if (hasSharedSecret(request)) return true;

  try {
    const session = await auth();
    return session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    log.warn("unauthorized safety-net attempt");
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const force = request.nextUrl.searchParams.get("force") === "1";
  // An unknown value is treated as the default rather than an error: this is a
  // scheduler endpoint, and answering 400 to a scheduler leaves the sweep
  // silently not happening. `essential` is the conservative reading.
  const scope: SafetyNetScope =
    request.nextUrl.searchParams.get("scope") === "all" ? "all" : "essential";
  const startedAt = Date.now();

  try {
    const result = await runStaleJobs({ force, scope });
    log.info("safety net complete", {
      scope,
      checked: result.checked,
      ran: result.ran.length,
      deferred: result.deferred.length,
      elapsedMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      success: true,
      mode: force ? "forced" : "stale-only",
      elapsedMs: Date.now() - startedAt,
      ...result,
    });
  } catch (error) {
    log.error("safety net failed", { error: String(error) });
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }
}
