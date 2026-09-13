import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getIntegrations } from "@/lib/integrations";
import { CRON_JOBS } from "@/lib/cron-schedule";
import { recordHeartbeat } from "@/lib/job-heartbeat";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("admin-integrations");

async function requireAdmin() {
  const session = await auth();
  const role = session?.user?.role;
  return role === "ADMIN" || role === "SUPER_ADMIN";
}

export async function GET() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const report = await getIntegrations();
    return NextResponse.json(report);
  } catch (error) {
    log.error("failed to build integrations report", { error: String(error) });
    return NextResponse.json({ error: "Failed to load integrations" }, { status: 500 });
  }
}

/**
 * Actions the console can trigger. Deliberately tiny: the console observes and
 * nudges, it does not reconfigure infrastructure from a browser tab — that is
 * what the Settings console (which is validated against the settings catalog)
 * is for.
 */
export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
    jobId?: string;
  };

  if (body.action === "run-job") {
    const job = CRON_JOBS.find((j) => j.id === body.jobId);
    if (!job) {
      return NextResponse.json({ error: `Unknown job: ${body.jobId}` }, { status: 404 });
    }

    const startedAt = Date.now();
    try {
      const result = await job.run();
      await recordHeartbeat(job.id, { ok: true, detail: "run from admin console" });
      log.info("admin ran scheduled job", { jobId: job.id, elapsedMs: Date.now() - startedAt });
      return NextResponse.json({
        ok: true,
        jobId: job.id,
        elapsedMs: Date.now() - startedAt,
        result,
      });
    } catch (error) {
      await recordHeartbeat(job.id, { ok: false, detail: "admin run failed" });
      log.error("admin job run failed", { jobId: job.id, error: String(error) });
      return NextResponse.json({ error: String(error) }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
