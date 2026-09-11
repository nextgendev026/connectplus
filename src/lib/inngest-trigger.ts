import { inngest } from "@/lib/inngest";
import { hasStaleFeeds, pollFeeds } from "@/lib/rss-poll";
import { createLogger } from "@/lib/logger";
import type { PollSummary } from "@/lib/rss-poll";

const log = createLogger("inngest-trigger");

export type RssPollResult =
  | { summary: PollSummary; mode: "direct" }
  | { mode: "inngest"; eventIds: string[] };

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