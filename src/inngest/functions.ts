import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { pollFeeds } from "@/lib/rss-poll";
import { hiveBrain } from "@/lib/hive-brain";
import { autoTagPost } from "@/lib/auto-tag";
import { createPublishNotifications } from "@/lib/notifications";
import { createLogger } from "@/lib/logger";

const log = createLogger("inngest");

/**
 * Publishes stories whose scheduledAt time has arrived. Runs every five
 * minutes via Inngest cron (robust on serverless, no Vercel cron dependency).
 */
export const publishScheduled = inngest.createFunction(
  {
    id: "publish-scheduled",
    name: "Publish scheduled stories",
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    const due = await step.run("find-due-posts", async () =>
      prisma.post.findMany({
        where: {
          status: "DRAFT",
          scheduledAt: { lte: new Date() },
          publishedAt: null,
        },
        select: {
          id: true,
          title: true,
          slug: true,
          content: true,
          excerpt: true,
          authorId: true,
          scheduledAt: true,
        },
      })
    );

    if (due.length === 0) return { published: 0 };

    let publishedCount = 0;

    for (const post of due) {
      const live = await step.run(`publish-${post.id}`, async () =>
        prisma.post.update({
          where: { id: post.id },
          data: {
            status: "PUBLISHED",
            moderationStatus: "APPROVED",
            publishedAt: post.scheduledAt ?? new Date(),
          },
          include: {
            author: { select: { name: true, username: true } },
            category: { select: { name: true, slug: true } },
          },
        })
      );

      await step.run(`notify-${post.id}`, async () =>
        createPublishNotifications({
          authorId: live.authorId,
          authorName: live.author.name ?? live.author.username,
          postId: live.id,
          postTitle: live.title,
        })
      );

      await step.run(`learn-${post.id}`, async () => {
        const hive = await hiveBrain.ingestPost(live);
        const tags = await autoTagPost(live.id, `${live.title} ${live.excerpt ?? ""}`);
        log.info("ingested published post", { postId: live.id, memories: hive, tags: tags.length });
      });

      publishedCount++;
    }

    return { published: publishedCount };
  }
);

/**
 * Polls all active RSS feeds. Triggered manually from the admin panel or by
 * the Inngest daily cron.
 */
export const rssPoll = inngest.createFunction(
  {
    id: "rss-poll",
    name: "Poll RSS feeds",
    triggers: [{ cron: "0 0 * * *" }, { event: "rss-poll" }],
  },
  async ({ step }) => {
    const summary = await step.run("poll-feeds", async () => pollFeeds());

    if (summary.newArticles > 0) {
      await step.run("neural-learn", async () => {
        const { neuralMind } = await import("@/lib/neural-mind");
        await neuralMind.learnFromRssArticles();
      });
    }

    return summary;
  }
);

/**
 * Polls a single RSS feed (used by the admin "poll feed" action).
 */
export const rssPollFeed = inngest.createFunction(
  {
    id: "rss-poll-feed",
    name: "Poll a single RSS feed",
    triggers: [{ event: "rss-poll-feed" }],
  },
  async ({ event, step }) => {
    const feedId = (event.data as { feedId?: string } | undefined)?.feedId;
    if (!feedId) return { error: "missing feedId" };

    return step.run("poll-feed", async () => pollFeeds(feedId));
  }
);

/**
 * Nightly deep-learning pass: sweeps the platform for new memories, trains the
 * hive brain, and ingests unlearned RSS articles.
 */
export const hiveSweep = inngest.createFunction(
  {
    id: "hive-sweep",
    name: "Nightly hive & neural training",
    triggers: [{ cron: "0 1 * * *" }],
  },
  async ({ step }) => {
    await step.run("sweep-internal", async () => hiveBrain.sweepInternal());
    await step.run("train-brain", async () => hiveBrain.train());
    await step.run("learn-rss", async () => {
      const { neuralMind } = await import("@/lib/neural-mind");
      await neuralMind.learnFromRssArticles();
    });

    return { ok: true };
  }
);

/**
 * Manual deep-learning trigger exposed to admins.
 */
export const neuralLearn = inngest.createFunction(
  {
    id: "neural-learn",
    name: "Deep neural learning pass",
    triggers: [{ event: "neural-learn" }],
  },
  async ({ step }) => {
    await step.run("learn-rss", async () => {
      const { neuralMind } = await import("@/lib/neural-mind");
      await neuralMind.learnFromRssArticles();
    });
    await step.run("sweep-internal", async () => hiveBrain.sweepInternal());

    return { ok: true };
  }
);

export const functions = [
  publishScheduled,
  rssPoll,
  rssPollFeed,
  hiveSweep,
  neuralLearn,
];