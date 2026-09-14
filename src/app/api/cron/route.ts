import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { inngest } from "@/lib/inngest";
import { createLogger } from "@/lib/logger";
import { recordHeartbeat } from "@/lib/job-heartbeat";
import { CRON_JOBS, getCronStatus } from "@/lib/cron-schedule";
import { hasSharedSecret } from "@/lib/shared-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Heavy jobs (hive sweep, embedding, feed polling) need longer than the 10s
// Hobby default; 300s is the ceiling on Vercel Pro.
export const maxDuration = 300;

const log = createLogger("cron");

/**
 * On-demand / external-cron entrypoint.
 *
 * TWO schedulers own production and neither of them is Vercel:
 *
 *   • Inngest — the primary cadence, one cron trigger per job (mirrored from
 *     lib/cron-schedule, which a unit test keeps honest).
 *   • cron-job.org — pings `GET /api/cron?trigger=<jobId>` as the external
 *     scheduler, which is also the manual/admin path.
 *
 * There is no trigger list in this file any more: it is DERIVED from the job
 * registry, so adding a job to cron-schedule wires the scheduler and this route
 * at the same time and the two can never drift.
 *
 *  Authorization: Bearer <CRON_SECRET>
 *  or x-cron-secret / ?key= / ?secret=   (same shared secret)
 *
 *  GET /api/cron                      → the schedule, heartbeats and cron-job.org
 *                                       setup payload (discovery)
 *  GET /api/cron?trigger=<jobId>      → run that job inline
 */

const TRIGGERS: Record<string, { run: () => Promise<unknown>; event: string; job: string }> =
  Object.fromEntries(
    CRON_JOBS.map((job) => [job.id, { run: () => job.run(), event: job.id, job: job.id }])
  );

/** Aliases kept so existing cron-job.org entries and docs keep working. */
const ALIASES: Record<string, string> = {
  "recover-thumbnails": "thumbnail-recovery",
  "radio-sweep": "radio-status-sweep",
};

function resolveTrigger(name: string | null): string | null {
  if (!name) return null;
  if (name in TRIGGERS) return name;
  const alias = ALIASES[name];
  return alias && alias in TRIGGERS ? alias : null;
}

async function authorize(request: NextRequest): Promise<boolean> {
  // Constant-time, and a missing CRON_SECRET refuses rather than falling
  // through to "no comparison happened" (see lib/shared-secret).
  if (hasSharedSecret(request)) return true;

  // Local dev convenience: an admin session may drive the scheduler manually.
  try {
    const session = await auth();
    return session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const isAuthorized = await authorize(request);
  if (!isAuthorized) {
    log.warn("unauthorized cron trigger attempt");
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const requested = request.nextUrl.searchParams.get("trigger");
  const trigger = resolveTrigger(requested);

  if (!trigger) {
    // Discovery: everything an external scheduler needs to be configured, plus
    // the live heartbeat for each job. With no `trigger` this is also how the
    // admin console reads the schedule.
    const status = await getCronStatus().catch(() => []);
    return NextResponse.json(
      {
        generatedAt: new Date().toISOString(),
        schedulers: ["inngest", "cron-job.org"],
        endpoint: "/api/cron?trigger=<jobId>",
        auth: "Authorization: Bearer <CRON_SECRET> (or x-cron-secret / ?key=)",
        jobs: status.map((job) => ({
          trigger: job.id,
          name: job.name,
          cron: job.cron,
          everyMinutes: job.everyMinutes,
          essential: job.essential,
          lastRun: job.lastRun,
          stale: job.stale,
          ok: job.ok,
        })),
        ...(requested && !trigger ? { unknownTrigger: requested } : {}),
      },
      { status: requested && !trigger ? 404 : 200 }
    );
  }

  const startedAt = Date.now();
  const { run, event, job } = TRIGGERS[trigger]!;

  try {
    const result = await run();
    await recordHeartbeat(job, { ok: true, detail: "run by /api/cron" });
    log.info("cron run complete", { trigger, elapsedMs: Date.now() - startedAt });
    const extra = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    return NextResponse.json({ success: true, trigger, elapsedMs: Date.now() - startedAt, ...extra });
  } catch (inlineErr) {
    await recordHeartbeat(job, { ok: false, detail: String(inlineErr).slice(0, 160) });
    log.error("cron run failed, trying Inngest fallback", { trigger, error: String(inlineErr) });

    if (process.env.INNGEST_EVENT_KEY) {
      try {
        const sent = await inngest.send({ name: event });
        const ids = Array.isArray((sent as { ids?: string[] } | undefined)?.ids)
          ? (sent as { ids: string[] }).ids
          : [];
        if (ids.length > 0) {
          log.warn("handed cron job to Inngest fallback", { trigger, event, eventIds: ids });
          return NextResponse.json({
            success: true,
            trigger,
            mode: "inngest-fallback",
            fallbackFrom: String(inlineErr),
            eventIds: ids,
            elapsedMs: Date.now() - startedAt,
          });
        }
        log.warn("inngest.send accepted nothing - reporting the inline failure", { trigger });
      } catch (fallbackErr) {
        log.error("inngest fallback send failed", { trigger, error: String(fallbackErr) });
      }
    }

    return NextResponse.json({ success: false, trigger, error: String(inlineErr) }, { status: 500 });
  }
}