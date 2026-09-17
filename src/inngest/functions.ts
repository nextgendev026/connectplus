import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest";
import { hiveBrain } from "@/lib/hive-brain";
import { autoTagPost } from "@/lib/auto-tag";
import { createPublishNotifications } from "@/lib/notifications";
import { createLogger } from "@/lib/logger";
import { redisIncr } from "@/lib/redis";
import { recordHeartbeat } from "@/lib/job-heartbeat";

const log = createLogger("inngest");

/**
 * Publishes stories whose scheduledAt time has arrived.
 *
 * Inngest owns the cadence (every 5 min, see CRON_JOBS in lib/cron-schedule);
 * the event trigger stays so /api/cron and the admin console can run it on
 * demand. Mirrors the `publish-scheduled` entry in the cron registry.
 */
export const publishScheduled = inngest.createFunction(
  {
    id: "publish-scheduled",
    name: "Publish scheduled stories",
    triggers: [{ event: "publish-scheduled" }, { cron: "*/5 * * * *" }],
    // Never overlap runs; retry transient DB blips.
    concurrency: 1,
    retries: 3,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("publish-scheduled"));

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
 * Polls all active RSS feeds. Inngest fires this twice a day (cron trigger
 * below, mirrored from CRON_JOBS); the event trigger remains for manual admin
 * runs and the safety net.
 *
 * Each feed runs as its OWN step: if a source hangs or a serverless window
 * ends mid-run, Inngest resumes from the next feed instead of losing the
 * whole cycle (the previous single-step version stalled feeds for days).
 */
export const rssPoll = inngest.createFunction(
  {
    id: "rss-poll",
    name: "Poll RSS feeds",
    // Twice a day, 00:00 and 12:00 UTC. Per-feed lastPolled intervals still
    // throttle individual sources, and one run at a time + a per-run cap keeps
    // outbound egress flat. The admin console can always force a poll.
    triggers: [{ event: "rss-poll" }, { cron: "0 */12 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("rss-poll"));

    const { listDueFeeds, pollSingleFeed, resolveDefaultAuthorId } = await import("@/lib/rss-poll");

    const due = await step.run("list-due-feeds", async () => listDueFeeds());
    const authorId = await step.run("resolve-author", async () => resolveDefaultAuthorId());

    const summaries: import("@/lib/rss-poll").FeedSummary[] = [];
    for (const [i, feed] of due.entries()) {
      // Stagger feeds so one cycle never spikes outbound egress against all
      // sources at once — free-tier friendly.
      if (i > 0) await step.sleep(`stagger-${feed.id}`, "500ms");
      const s = await step.run(`poll-feed-${feed.id}`, async () => pollSingleFeed(feed, authorId));
      summaries.push(s);
    }

    const totalNew = summaries.reduce((n, s) => n + s.newArticles, 0);
    if (totalNew > 0) {
      await step.run("neural-learn", async () => {
        const { neuralMind } = await import("@/lib/neural-mind");
        await neuralMind.learnFromRssArticles();
      });
    }

    return {
      feedsPolled: summaries.length,
      newArticles: totalNew,
      errors: summaries.filter((s) => s.error).length,
      details: summaries.map(({ feedName, newArticles, error }) => ({ feedName, newArticles, error })),
    };
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

    return step.run("poll-feed", async () => {
      const { listDueFeeds, pollSingleFeed, resolveDefaultAuthorId } = await import("@/lib/rss-poll");
      const [feed] = await listDueFeeds(feedId);
      // A single-feed trigger bypasses the interval throttle so admins can
      // force-run a feed; fall back to fetching the record directly.
      const target = feed ??
        (await prisma.rssFeed.findUnique({
          where: { id: feedId },
          select: { id: true, name: true, url: true },
        }));
      if (!target) return { feedId, feedName: "", newArticles: 0, error: "feed not found" };
      const authorId = await resolveDefaultAuthorId();
      return pollSingleFeed(target, authorId);
    });
  }
);

/**
 * Nightly deep-learning pass: sweeps the platform for new memories, trains the
 * hive brain, and ingests unlearned RSS articles.
 *
 * Deep pass at 01:00 UTC — lowest-traffic window — never stacked; DB-heavy
 * steps run serially via step.run already. Inngest cron owns the schedule, the
 * event trigger stays for on-demand admin runs.
 */
export const hiveSweep = inngest.createFunction(
  {
    id: "hive-sweep",
    name: "Nightly hive & neural training",
    triggers: [{ event: "hive-sweep" }, { cron: "0 1 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("hive-sweep"));

    await step.run("sweep-internal", async () => hiveBrain.sweepInternal());
    await step.run("train-brain", async () => hiveBrain.train());
    await step.run("learn-rss", async () => {
      const { neuralMind } = await import("@/lib/neural-mind");
      await neuralMind.learnFromRssArticles();
    });

    // Fold the day's Convex view deltas back into Post.viewCount. Article
    // renders write to Convex (off Supabase's write budget); this one nightly
    // pass keeps Postgres authoritative for ranking and display.
    const synced = await step.run("sync-view-counts", async () => {
      const { foldConvexViews } = await import("@/lib/view-sync");
      const folded = await foldConvexViews(500);
      return { posts: folded.posts, views: folded.views };
    });

    return { ok: true, viewSync: synced };
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
    triggers: [{ event: "embed-posts" }, { cron: "30 1 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("embed-posts"));

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
    triggers: [{ event: "radio-status-sweep" }, { cron: "*/15 * * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("radio-status-sweep"));

    const summary = await step.run("sweep-statuses", async () => {
      const { sweepAllStationStatuses } = await import("@/lib/radio-status-fetch");
      return sweepAllStationStatuses();
    });
    return summary;
  }
);

/**
 * Payment reconciliation and expiry. Mirrors `payments-lifecycle` in the cron
 * registry: repairs PayPal drift, ends lapsed periods, and reports prompts that
 * never resolved.
 */
export const paymentsLifecycle = inngest.createFunction(
  {
    id: "payments-lifecycle",
    name: "Reconcile payments & expire lapsed memberships",
    triggers: [{ event: "payments-lifecycle" }, { cron: "30 */6 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("payments-lifecycle"));
    return step.run("reconcile", async () => {
      const { runPaymentsLifecycle } = await import("@/lib/cron-jobs");
      return runPaymentsLifecycle();
    });
  }
);

/**
 * Platform pulse.
 *
 * Six-hourly monitoring pass that records traffic depth, the creator roster
 * shape and revenue into the hive, diffed against the previous reading. The
 * point is that the mind can report a *trend* — bounce rate rising, returning
 * share falling — instead of a single number with nothing to compare it to.
 */
export const platformPulse = inngest.createFunction(
  {
    id: "platform-pulse",
    name: "Platform pulse & monitoring",
    triggers: [{ event: "platform-pulse" }, { cron: "45 */6 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("platform-pulse"));
    return step.run("pulse", async () => {
      const { runPlatformPulse } = await import("@/lib/cron-jobs");
      return runPlatformPulse();
    });
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
    triggers: [{ event: "status-watchdog" }, { cron: "*/5 * * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("status-watchdog"));

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
    await step.run("heartbeat", () => recordHeartbeat("status-daily-snapshot"));

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
 * Thumbnail recovery: finds syndicated posts that ended up without a cover and
 * re-derives one (in-content image first, then OpenGraph). Previously this only
 * ran when an admin clicked a button, so a feed that shipped no image left a
 * permanent gap in the feed.
 *
 * Cadence + batch size are deliberately modest: 20 items four times a day is
 * enough to drain a backlog without ever spiking egress against external sites.
 */
export const thumbnailRecovery = inngest.createFunction(
  {
    id: "thumbnail-recovery",
    name: "Recover missing thumbnails",
    triggers: [{ event: "recover-thumbnails" }, { cron: "15 */6 * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("thumbnail-recovery"));

    const summary = await step.run("recover", async () => {
      const { recoverMissingThumbnails } = await import("@/lib/rss-poll");
      return recoverMissingThumbnails({ limit: 20 });
    });

    if (summary.recovered > 0) {
      await step.run("invalidate-feed", async () => {
        await redisIncr("feed:version").catch(() => {});
      });
    }
    return summary;
  }
);

/**
 * Whole-registry RSS drain.
 *
 * The admin console used to drive this by looping an inline 300s HTTP request,
 * so a large backlog could not be worked through without pinning a request —
 * and any mid-run failure lost the remaining feeds. Here every feed is its own
 * Inngest step and progress is mirrored to Redis, so the console keeps its live
 * progress stream while the actual work survives restarts and serverless limits.
 */
export const rssDrain = inngest.createFunction(
  {
    id: "rss-drain",
    name: "Drain the whole RSS registry",
    triggers: [{ event: "rss-drain" }],
    // One drain at a time: the registry is finite and hammering every source in
    // parallel is exactly what the per-feed stagger exists to avoid.
    concurrency: 1,
    retries: 1,
  },
  async ({ event, step }) => {
    const runId = (event.data as { runId?: string } | undefined)?.runId;
    if (!runId) return { error: "missing runId" };

    const { listDueFeeds, pollSingleFeed, resolveDefaultAuthorId } = await import("@/lib/rss-poll");
    const { startDrain, recordDrainFeed, finishDrain, failDrain, isDrainCancelled } = await import("@/lib/rss-drain");

    try {
      const due = await step.run("list-due-feeds", async () => listDueFeeds());
      const authorId = await step.run("resolve-author", async () => resolveDefaultAuthorId());
      await step.run("mark-start", async () => startDrain(runId, due.length));

      let newArticles = 0;
      let errors = 0;
      let cancelled = false;

      for (const [i, feed] of due.entries()) {
        // Cooperative cancel: plain (un-memoized) read so a flag set mid-run is
        // seen. Already-polled feeds stay polled; the rest keep their old
        // lastPolled, so a later drain resumes exactly where this one stopped.
        if (await isDrainCancelled(runId)) {
          cancelled = true;
          break;
        }
        if (i > 0) await step.sleep(`stagger-${feed.id}`, "500ms");
        const summary = await step.run(`drain-feed-${feed.id}`, async () => {
          const result = await pollSingleFeed(feed, authorId);
          await recordDrainFeed(
            runId,
            {
              name: result.feedName,
              status: result.status ?? (result.error ? "ERROR" : "OK"),
              newArticles: result.newArticles,
              items: result.itemCount,
              durationMs: result.durationMs,
              error: result.error,
            },
            i + 1,
            feed.id
          );
          return result;
        });
        newArticles += summary.newArticles;
        if (summary.error) errors += 1;
      }

      await step.run("mark-finish", async () =>
        finishDrain(runId, { total: due.length, newArticles, errors, dueRemaining: 0, cancelled })
      );

      if (newArticles > 0) {
        await step.run("neural-learn", async () => {
          const { neuralMind } = await import("@/lib/neural-mind");
          await neuralMind.learnFromRssArticles();
        });
      }

      return { runId, feedsPolled: due.length, newArticles, errors, cancelled };
    } catch (err) {
      await failDrain(runId, err instanceof Error ? err.message : "drain failed").catch(() => {});
      throw err;
    }
  }
);

/**
 * Sports intelligence sweep. Folds every fixture the hub has seen into neural
 * memory, regenerates betting picks and grades the ones that have finished, so
 * the hive mind's sports corpus (and its accuracy record) keeps improving
 * without a single request from a browser.
 */
export const sportsIntel = inngest.createFunction(
  {
    id: "sports-intel",
    name: "Sports intelligence & betting picks",
    triggers: [{ event: "sports-intel" }, { cron: "*/30 * * * *" }],
    concurrency: 1,
    retries: 2,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("sports-intel"));

    const result = await step.run("analyse-fixtures", async () => {
      const { runSportsIntelligence } = await import("@/lib/sports-intelligence");
      return runSportsIntelligence({ limit: 40, teach: true });
    });

    return result;
  }
);

/**
 * Livescore heartbeat. Keeps the merged snapshot cache warm and grades finished
 * fixtures every couple of minutes so the board is never serving stale state to
 * the first visitor after a deploy.
 */
export const sportsLive = inngest.createFunction(
  {
    id: "sports-live",
    name: "Livescore snapshot & settlement",
    triggers: [{ event: "sports-live" }, { cron: "*/2 * * * *" }],
    concurrency: 1,
    retries: 1,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("sports-live"));
    return step.run("refresh-board", async () => {
      const { runSportsLive } = await import("@/lib/cron-jobs");
      return runSportsLive();
    });
  }
);

/**
 * Favourite alerts. Fans a reader's starred fixtures and followed teams out into
 * notifications; the (user, match, event) ledger keeps it idempotent, so running
 * it every five minutes never double-sends.
 */
export const sportsNotify = inngest.createFunction(
  {
    id: "sports-notify",
    name: "Favourite match notifications",
    triggers: [{ event: "sports-notify" }, { cron: "*/5 * * * *" }],
    concurrency: 1,
    retries: 1,
  },
  async ({ step }) => {
    await step.run("heartbeat", () => recordHeartbeat("sports-notify"));
    return step.run("fan-out", async () => {
      const { runSportsNotify } = await import("@/lib/cron-jobs");
      return runSportsNotify();
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
  rssDrain,
  hiveSweep,
  embedPosts,
  neuralLearn,
  radioStatusSweep,
  thumbnailRecovery,
  sportsLive,
  sportsNotify,
  sportsIntel,
  statusWatchdog,
  statusDailySnapshot,
  paymentsLifecycle,
  platformPulse,
];