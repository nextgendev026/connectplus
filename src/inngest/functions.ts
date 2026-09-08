import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { pollFeeds } from "@/lib/rss-poll";
import { hiveBrain } from "@/lib/hive-brain";
import { autoTagPost } from "@/lib/auto-tag";
import { createPublishNotifications } from "@/lib/notifications";
import { createLogger } from "@/lib/logger";
import { redisIncr } from "@/lib/redis";

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
    // Never overlap runs; retry transient DB blips.
    concurrency: 1,
    retries: 3,
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
          moderationStatus: true,
        },
      })
    );

    if (due.length === 0) return { published: 0 };

    let publishedCount = 0;

    for (const post of due) {
      const live = await step.run(`publish-${post.id}`, async () => {
        // Trusted writers (CREATOR + ADMIN tier) go straight to APPROVED;
        // regular users' scheduled posts publish but stay PENDING in the
        // moderation queue until an admin approves them.
        const author = await prisma.user.findUnique({
          where: { id: post.authorId },
          select: { role: true, emailVerified: true },
        });
        const trusted =
          author != null &&
          (author.role === "CREATOR" ||
            author.role === "ADMIN" ||
            author.role === "SUPER_ADMIN") &&
          author.emailVerified != null;
        const moderationStatus =
          post.moderationStatus === "REJECTED" || post.moderationStatus === "FLAGGED"
            ? post.moderationStatus
            : trusted
              ? "APPROVED"
              : post.moderationStatus === "APPROVED"
                ? post.moderationStatus
                : "PENDING";

        return prisma.post.update({
          where: { id: post.id },
          data: {
            status: "PUBLISHED",
            moderationStatus,
            publishedAt: post.scheduledAt ?? new Date(),
          },
          include: {
            author: { select: { name: true, username: true } },
            category: { select: { name: true, slug: true } },
          },
        });
      });

      if (live.moderationStatus === "APPROVED") {
        await step.run(`notify-${post.id}`, async () =>
          createPublishNotifications({
            authorId: live.authorId,
            authorName: live.author.name ?? live.author.username,
            postId: live.id,
            postTitle: live.title,
          })
        );
      }

      await step.run(`learn-${post.id}`, async () => {
        const hive = await hiveBrain.ingestPost(live);
        const tags = await autoTagPost(live.id, `${live.title} ${live.excerpt ?? ""}`);
        log.info("ingested published post", { postId: live.id, memories: hive, tags: tags.length });
      });

      await step.run(`embed-${post.id}`, async () => {
        const { embedPost } = await import("@/lib/neural-vector");
        await embedPost({ id: post.id, title: post.title, excerpt: post.excerpt, content: post.content });
      });

      publishedCount++;
    }

    if (publishedCount > 0) {
      await step.run("invalidate-feed", async () => {
        await redisIncr("feed:version").catch(() => {});
      });
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
    // Re-poll on the hour; per-feed lastPolled intervals throttle actual fetches.
    // One run at a time + a cap keeps outbound egress and Postgres writes flat.
    triggers: [{ cron: "0 * * * *" }, { event: "rss-poll" }],
    concurrency: 1,
    retries: 2,
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
    concurrency: 2,
    retries: 2,
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
    // Deep pass at 01:00 UTC — lowest-traffic window — never stacked, DB-heavy
    // steps run serially via step.run already.
    triggers: [{ cron: "0 1 * * *" }],
    concurrency: 1,
    retries: 2,
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
 * Semantic index maintenance: embeds any published post that is missing or
 * stale. Runs nightly, plus on demand via the "embed-posts" event.
 */
export const embedPosts = inngest.createFunction(
  {
    id: "embed-posts",
    name: "Index semantic embeddings",
    // Batches at most 400 posts/run; single concurrency keeps pgvector writes
    // and embedding egress predictable.
    triggers: [{ cron: "0 3 * * *" }, { event: "embed-posts" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    const embedded = await step.run("index-published", async () => {
      const { indexPublishedPosts } = await import("@/lib/neural-vector");
      return indexPublishedPosts(400);
    });
    return { embedded };
  }
);

/**
 * Radio metadata sweep: refreshes now-playing/listeners for every station
 * into the Redis cache every 15 minutes, so the status API serves warm
 * cache instead of hitting 35 upstream stream servers per request.
 */
export const radioStatusSweep = inngest.createFunction(
  {
    id: "radio-status-sweep",
    name: "Refresh radio station metadata",
    // Every 15 min — plenty for song/listener metadata; a single sweep hits
    // each upstream once with a timeout, keeping free-tier egress flat.
    triggers: [{ cron: "*/15 * * * *" }, { event: "radio-status-sweep" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    const summary = await step.run("sweep-statuses", async () => {
      const { sweepAllStationStatuses } = await import("@/lib/radio-status-fetch");
      return sweepAllStationStatuses();
    });
    return summary;
  }
);

/**
 * Status watchdog: runs the health checks every 5 minutes and alerts when a
 * service degrades or goes down. Uses `status:alert:<service>` cooldown keys
 * in Redis (6h) so a flapping service doesn't spam — one alert per episode.
 * Email goes through the shared mailer (RESEND_API_KEY); STATUS_WEBHOOK_URL
 * additionally receives a JSON payload (Slack/Discord/generic compatible).
 */
export const statusWatchdog = inngest.createFunction(
  {
    id: "status-watchdog",
    name: "Status watchdog alerts",
    triggers: [{ cron: "*/5 * * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    const alerts = await step.run("probe-services", async () => {
      const { runChecks, alertRecipients, alertWebhookUrl } = await import("@/lib/status-alerts");
      const checks = await runChecks();
      const bad = checks.services.filter((s) => s.status === "down" || s.status === "degraded");
      if (bad.length === 0) return [] as { id: string; name: string; status: string; detail: string }[];

      const { redisGetRaw, redisSetEx } = await import("@/lib/redis");
      const sendable: typeof bad = [];
      for (const s of bad) {
        const key = `status:alert:${s.id}`;
        const last = await redisGetRaw(key).catch(() => null);
        if (last) continue; // already alerted for this episode
        await redisSetEx(key, 6 * 60 * 60, new Date().toISOString());
        sendable.push(s);
      }
      if (sendable.length === 0) return [];

      const recipients = await alertRecipients();
      const lines = sendable.map(
        (s) => `• ${s.name}: ${s.status.toUpperCase()} — ${s.detail}`
      );
      const subject = `[connectPlus] ${sendable.length} service${sendable.length === 1 ? "" : "s"} ${
        sendable.some((s) => s.status === "down") ? "DOWN" : "degraded"
      }`;

      // Email (best-effort; mailer logs in dev when RESEND_API_KEY is unset).
      if (recipients.length > 0) {
        const { sendEmail } = await import("@/lib/mailer");
        await Promise.allSettled(
          recipients.map((to) =>
            sendEmail({
              to,
              subject,
              text: `connectPlus status alert (${new Date().toISOString()})\n\n${lines.join("\n")}\n\n— connectPlus status watchdog`,
            })
          )
        );
      }

      // Webhook (Slack/Discord/generic JSON) — admin-managed URL with env override.
      const webhook = await alertWebhookUrl();
      if (webhook) {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `${subject}\n${lines.join("\n")}`,
            content: `${subject}\n${lines.join("\n")}`,
            alerts: sendable.map((s) => ({ service: s.id, status: s.status, detail: s.detail })),
          }),
          signal: AbortSignal.timeout(8000),
        }).catch(() => {});
      }

      return sendable.map((s) => ({ id: s.id, name: s.name, status: s.status, detail: s.detail }));
    });

    return { alerted: alerts.length, alerts };
  }
);

/**
 * Daily status snapshot: probes once at 00:05 UTC and stamps the day's
 * baseline into the 90-day history so a day with no visitors still shows
 * its first-hours result (recordAndReadHistory escalates from there).
 */
export const statusDailySnapshot = inngest.createFunction(
  {
    id: "status-daily-snapshot",
    name: "Daily status history snapshot",
    triggers: [{ cron: "5 0 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    return step.run("snapshot", async () => {
      const { runChecks, recordAndReadHistory } = await import("@/lib/status");
      const checks = await runChecks();
      const history = await recordAndReadHistory(checks.services);
      return {
        overall: checks.overall,
        recorded: Object.keys(history).length,
      };
    });
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
    concurrency: 1,
    retries: 2,
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
  embedPosts,
  neuralLearn,
  radioStatusSweep,
  statusWatchdog,
  statusDailySnapshot,
];