import { prisma } from "@/lib/prisma";
import { hiveBrain, type HiveSweepResult } from "@/lib/hive-brain";
import { pollFeeds, recoverMissingThumbnails, type PollSummary, type ThumbnailRecoverySummary } from "@/lib/rss-poll";
import { sweepAllStationStatuses } from "@/lib/radio-status-fetch";
import { autoTagPost } from "@/lib/auto-tag";
import { createPublishNotifications } from "@/lib/notifications";
import { redisIncr } from "@/lib/redis";
import { createLogger } from "@/lib/logger";

const log = createLogger("cron-jobs");

/**
 * Cron-job.org runner set. cron-job.org pings /api/cron on a schedule; each
 * trigger below does the same work the matching Inngest function does, so the
 * heavy jobs run on the free, open-source scheduler. When an inline run fails
 * and Inngest Cloud is configured with a matching event, /api/cron hands the
 * job to Inngest as a fallback.
 */

/** 
 * RSS poll. Runs the poll inline so cron-job.org owns the cadence; on failure
 * /api/cron queues the `rss-poll` event to Inngest as a fallback.
 */
export async function runRssPollInline(): Promise<PollSummary> {
  return pollFeeds();
}

/** Publish stories whose scheduledAt time has arrived. */
export async function runPublishScheduled(): Promise<{ published: number }> {
  const due = await prisma.post.findMany({
    where: { status: "DRAFT", scheduledAt: { lte: new Date() }, publishedAt: null },
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
  });

  if (due.length === 0) return { published: 0 };

  let publishedCount = 0;

  for (const post of due) {
    const author = await prisma.user.findUnique({
      where: { id: post.authorId },
      select: { role: true, emailVerified: true },
    });
    // Trusted writers (CREATOR + ADMIN tier) go straight to APPROVED; regular
    // users' scheduled posts publish but stay PENDING in the moderation queue.
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

    const live = await prisma.post.update({
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

    if (live.moderationStatus === "APPROVED") {
      await createPublishNotifications({
        authorId: live.authorId,
        authorName: live.author.name ?? live.author.username,
        postId: live.id,
        postTitle: live.title,
      });
    }

    const { embedPost } = await import("@/lib/neural-vector");
    const memories = await hiveBrain.ingestPost(live);
    const tags = await autoTagPost(live.id, `${live.title} ${live.excerpt ?? ""}`);
    await embedPost({ id: post.id, title: post.title, excerpt: post.excerpt, content: post.content });
    log.info("ingested published post", { postId: live.id, memories, tags: tags.length });

    publishedCount++;
  }

  if (publishedCount > 0) {
    await redisIncr("feed:version").catch(() => {});
  }

  return { published: publishedCount };
}

/**
 * Nightly deep-learning pass: sweeps the platform for new memories, trains the
 * hive brain, ingests unlearned RSS articles, and folds Convex view deltas
 * back into Post.viewCount so Postgres stays authoritative for ranking.
 */
export async function runHiveSweep(): Promise<{ ok: boolean; sweep: HiveSweepResult; viewSync: { posts: number; views: number } }> {
  const sweep = await hiveBrain.sweepInternal();
  await hiveBrain.train();

  const { neuralMind } = await import("@/lib/neural-mind");
  await neuralMind.learnFromRssArticles();

  const { convexPendingViews, convexMarkViewsSynced } = await import("@/lib/convex");
  const deltas = await convexPendingViews(500);
  let views = 0;
  const applied: string[] = [];
  for (const d of deltas) {
    const ok = await prisma.post
      .update({ where: { id: d.postId }, data: { viewCount: { increment: d.delta } } })
      .then(() => true)
      .catch(() => false);
    if (ok) {
      applied.push(d.postId);
      views += d.delta;
    }
  }
  const synced = await convexMarkViewsSynced(applied);

  return { ok: true, sweep, viewSync: { posts: synced, views } };
}

/** Semantic index maintenance: embed published posts missing or stale. */
export async function runEmbedPosts(limit = 400): Promise<{ embedded: number }> {
  const { indexPublishedPosts } = await import("@/lib/neural-vector");
  return { embedded: await indexPublishedPosts(limit) };
}

/** Re-derive cover images for syndicated posts that shipped without one. */
export async function runRecoverThumbnails(limit = 20): Promise<ThumbnailRecoverySummary> {
  const summary = await recoverMissingThumbnails({ limit });
  if (summary.recovered > 0) {
    await redisIncr("feed:version").catch(() => {});
  }
  return summary;
}

/** Refresh every station's now-playing/listener metadata into the Redis cache. */
export async function runRadioSweep(): Promise<{ total: number; live: number; withMeta: number; errors: string[] }> {
  return sweepAllStationStatuses();
}

/**
 * Status watchdog: probes services and alerts on degradation/downtime, with a
 * Redis cooldown so a flapping service doesn't spam (one alert per episode).
 */
export async function runStatusWatchdog(): Promise<{
  alerted: number;
  alerts: { id: string; name: string; status: string; detail: string }[];
}> {
  const { runChecks, alertRecipients, alertWebhookUrl } = await import("@/lib/status-alerts");
  const checks = await runChecks();
  const bad = checks.services.filter((s) => s.status === "down" || s.status === "degraded");
  if (bad.length === 0) return { alerted: 0, alerts: [] };

  const { redisGetRaw, redisSetEx } = await import("@/lib/redis");
  const sendable: typeof bad = [];
  for (const s of bad) {
    const key = `status:alert:${s.id}`;
    const last = await redisGetRaw(key).catch(() => null);
    if (last) continue; // already alerted for this episode
    await redisSetEx(key, 6 * 60 * 60, new Date().toISOString());
    sendable.push(s);
  }
  if (sendable.length === 0) return { alerted: 0, alerts: [] };

  const recipients = await alertRecipients();
  const lines = sendable.map((s) => `• ${s.name}: ${s.status.toUpperCase()} — ${s.detail}`);
  const subject = `[connectPlus] ${sendable.length} service${sendable.length === 1 ? "" : "s"} ${
    sendable.some((s) => s.status === "down") ? "DOWN" : "degraded"
  }`;

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

  return { alerted: sendable.length, alerts: sendable.map((s) => ({ id: s.id, name: s.name, status: s.status, detail: s.detail })) };
}