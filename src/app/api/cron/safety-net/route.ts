import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runStaleEssentialJobs } from "@/lib/cron-schedule";
import { hasSharedSecret } from "@/lib/shared-secret";
import { createLogger } from "@/lib/logger";

/**
 * The one job Vercel's cron still owns.
 *
 * Inngest drives every cadence (see src/inngest/functions.ts). This endpoint
 * exists purely as a fallback for the case where the Inngest app is unsynced,
 * paused, or unlinked: it inspects the cron heartbeat ledger and runs ONLY the
 * essential jobs whose last heartbeat is stale. While Inngest is healthy this
 * is a cheap no-op — a few Redis reads and an empty response.
 *
 *   GET /api/cron/safety-net             stale essentials only
 *   GET /api/cron/safety-net?force=1     run all essentials now (admin/secret)
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
  const startedAt = Date.now();

  try {
    const result = await runStaleEssentialJobs({ force });
    log.info("safety net complete", {
      checked: result.checked,
      ran: result.ran.length,
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
