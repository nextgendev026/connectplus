import { inngest } from "@/lib/inngest";
import { hasStaleFeeds, pollFeeds } from "@/lib/rss-poll";
import { createLogger } from "@/lib/logger";
import type { PollSummary } from "@/lib/rss-poll";

const log = createLogger("inngest-trigger");

export type RssPollResult =
  | { summary: PollSummary; mode: "direct" }
  | { mode: "inngest"; eventIds: string[] };

/**
 * Event names that actually have an Inngest function registered against them.
 *
 * This list is the guard against the most expensive kind of silent failure in
 * this codebase. `inngest.send` accepts any event name and returns event ids for
 * it, so a caller that treats "send succeeded" as "work queued" will conclude a
 * job is running when nothing is listening and nothing will ever run. The
 * original RSS trigger hit exactly that (see the comment in `triggerRssPoll`),
 * and the sports route's `sports-kickoff-refresh` looks identical to its
 * neighbours while having no handler at all.
 *
 * Handlers live in src/inngest/functions.ts; a unit test asserts the two agree.
 */
export const HANDLED_EVENTS: ReadonlySet<string> = new Set([
  "embed-posts",
  "hive-sweep",
  "neural-learn",
  "payments-lifecycle",
  "platform-pulse",
  "publish-scheduled",
  "radio-status-sweep",
  "rss-drain",
  "rss-poll",
  "rss-poll-feed",
  "sports-intel",
  "sports-live",
  "sports-notify",
  "status-watchdog",
  "status-daily-snapshot",
  "thumbnail-recovery",
]);

export type JobTriggerResult = { mode: "inngest"; eventIds: string[] } | { mode: "inline" };

/**
 * Hand a background job to Inngest and say whether it was accepted.
 *
 * The point is the *answer*, not the send. Callers use it to choose between two
 * mutually exclusive paths — queue the work, or do it themselves — which is what
 * stops a route from executing the same job twice, once on the queue and once on
 * the request's own compute. Measured against the previous behaviour in
 * `/api/sports/live`, where three jobs were sent to Inngest *and* run inline on
 * every poll of the busiest page in the app.
 *
 * Returns `inline` whenever acceptance cannot be proven: no event key, a send
 * failure, an empty id list, or an event name with no handler. The caller then
 * falls back, so a job is never lost to a queue that quietly is not there.
 */
export async function triggerJob(name: string, data?: Record<string, unknown>): Promise<JobTriggerResult> {
  if (!HANDLED_EVENTS.has(name)) {
    log.warn("no Inngest handler for this event - caller must run it inline", { name });
    return { mode: "inline" };
  }

  if (!process.env.INNGEST_EVENT_KEY) return { mode: "inline" };

  try {
    const sent = await inngest.send({ name, data });
    const eventIds = (sent as { ids?: string[] } | undefined)?.ids ?? [];
    if (eventIds.length > 0) return { mode: "inngest", eventIds };
    log.warn("inngest accepted no event ids - caller must run this job inline", { name });
  } catch (err) {
    log.warn("inngest.send failed - caller must run this job inline", { name, error: err });
  }

  return { mode: "inline" };
}

/**
 * Trigger an RSS poll through Inngest when an event key is configured so the
 * work runs in the Inngest Cloud queue. Without an event key (Inngest Cloud
 * not linked yet), fall back to running the poll inline so manual triggers and
 * Vercel cron keep working regardless.
 */
export async function triggerRssPoll(
  feedId?: string,
  opts: { inline?: boolean } = {}
): Promise<RssPollResult> {
  if (process.env.INNGEST_EVENT_KEY && !opts.inline && !(await hasStaleFeeds(3))) {
    try {
      const sent = await inngest.send({
        name: feedId ? "rss-poll-feed" : "rss-poll",
        data: feedId ? { feedId } : undefined,
      });
      const eventIds = (sent as { ids?: string[] } | undefined)?.ids ?? [];
      if (eventIds.length > 0) {
        return { mode: "inngest", eventIds };
      }
      // An event key that produces no event id means the queue accepted
      // nothing (wrong environment / unsynced app). Previously we returned
      // "scheduled" anyway and NOTHING ran — the poll looked successful while
      // every feed silently stopped importing. Fall through to inline work.
      log.warn("inngest.send returned no event ids - running the poll inline instead");
    } catch (err) {
      log.warn("inngest.send failed - running the poll inline instead", { error: err });
    }
  }

  log.info("running RSS poll inline");
  const summary = await pollFeeds(feedId);
  return { mode: "direct", summary };
}