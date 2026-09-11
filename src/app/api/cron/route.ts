import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { inngest } from "@/lib/inngest";
import { createLogger } from "@/lib/logger";
import {
  runPublishScheduled,
  runHiveSweep,
  runEmbedPosts,
  runRecoverThumbnails,
  runRadioSweep,
  runRssPollInline,
  runStatusWatchdog,
} from "@/lib/cron-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Heavy jobs (hive sweep, embedding, feed polling) need longer than the 10s
// Hobby default; 300s is the ceiling on Vercel Pro.
export const maxDuration = 300;

const log = createLogger("cron");

/**
 * cron-job.org entrypoint. Schedules ping this endpoint with a trigger name
 * and each trigger runs the matching heavy job inline, so the free,
 * open-source scheduler owns the cadence. When an inline run fails and Inngest
 * Cloud is configured, the run is handed to Inngest as a durable fallback.
 *
 *  Authorization: Bearer <CRON_SECRET>
 *  or x-cron-secret / ?key= / ?secret=   (same shared secret)
 *
 *  GET /api/cron?trigger=hive-sweep
 *  GET /api/cron?trigger=rss-poll
 *  GET /api/cron?trigger=embed-posts
 *  GET /api/cron?trigger=recover-thumbnails
 *  GET /api/cron?trigger=radio-sweep
 *  GET /api/cron?trigger=publish-scheduled
 *  GET /api/cron?trigger=status-watchdog
 */

const TRIGGERS = {
  "rss-poll": { run: () => runRssPollInline(), event: "rss-poll" },
  "hive-sweep": { run: () => runHiveSweep(), event: "hive-sweep" },
  "embed-posts": { run: () => runEmbedPosts(), event: "embed-posts" },
  "recover-thumbnails": { run: () => runRecoverThumbnails(), event: "recover-thumbnails" },
  "radio-sweep": { run: () => runRadioSweep(), event: "radio-status-sweep" },
  "publish-scheduled": { run: () => runPublishScheduled(), event: "publish-scheduled" },
  "status-watchdog": { run: () => runStatusWatchdog(), event: "status-watchdog" },
} as const;

type TriggerName = keyof typeof TRIGGERS;

async function authorize(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const viaHeader = request.headers.get("authorization") === `Bearer ${secret}`;
    const viaX = request.headers.get("x-cron-secret") === secret;
    const viaQuery =
      request.nextUrl.searchParams.get("secret") === secret ||
      request.nextUrl.searchParams.get("key") === secret;
    if (viaHeader || viaX || viaQuery) return true;
  }

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

  const trigger = request.nextUrl.searchParams.get("trigger") as TriggerName | null;
  if (!trigger || !(trigger in TRIGGERS)) {
    return NextResponse.json(
      {
        error: "Unknown trigger",
        availableTriggers: Object.keys(TRIGGERS),
      },
      { status: 404 }
    );
  }

  const startedAt = Date.now();
  const { run, event } = TRIGGERS[trigger];

  try {
    const result = await run();
    log.info("cron run complete", { trigger, elapsedMs: Date.now() - startedAt });
    return NextResponse.json({ success: true, trigger, elapsedMs: Date.now() - startedAt, ...result });
  } catch (inlineErr) {
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