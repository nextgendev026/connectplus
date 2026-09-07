import { inngest } from "@/lib/inngest";
import { pollFeeds } from "@/lib/rss-poll";
import { createLogger } from "@/lib/logger";
import type { PollSummary } from "@/lib/rss-poll";

const log = createLogger("inngest-trigger");

export type RssPollResult = { summary: PollSummary; mode: "direct" } | { mode: "inngest" };

/**
 * Trigger an RSS poll through Inngest when an event key is configured so the
 * work runs in the Inngest Cloud queue. Without an event key (Inngest Cloud
 * not linked yet), fall back to running the poll inline so manual triggers and
 * Vercel cron keep working regardless.
 */
export async function triggerRssPoll(feedId?: string): Promise<RssPollResult> {
  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: feedId ? "rss-poll-feed" : "rss-poll",
      data: feedId ? { feedId } : undefined,
    });
    return { mode: "inngest" };
  }

  log.info("no INNGEST_EVENT_KEY set - running RSS poll inline");
  const summary = await pollFeeds(feedId);
  return { mode: "direct", summary };
}