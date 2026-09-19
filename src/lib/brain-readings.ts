import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import { neuralMind } from "@/lib/neural-mind";
import { hiveBrain } from "@/lib/hive-brain";
import { getCronStatus } from "@/lib/cron-schedule";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { openIssues } from "@/lib/brain-issues";
import { activeCacheBackend } from "@/lib/redis";
import { getAiConfig } from "@/lib/ai-provider";
import { convexAvailable, convexHealth } from "@/lib/convex";

/**
 * The brain's read access to its own platform.
 *
 * The combined mind could always *talk* about the platform, but too much of what
 * it said was assembled from whichever subsystem the question happened to route
 * to — an answer about revenue never knew the scheduler was behind, and an answer
 * about traffic never knew three of the feeds had stopped importing. That is not
 * understanding; it is retrieval.
 *
 * This gathers one flat, labelled set of facts from every subsystem in a single
 * pass and renders it as a compact brief. Three properties are deliberate:
 *
 *   • **Read-only.** Nothing here writes. That is what lets the brain be given
 *     the whole platform without a human in the loop on every question — reads
 *     are free, and writes go through the approval queue.
 *   • **Every probe degrades alone.** One unreachable subsystem costs its own
 *     line, not the brief. A reading that could not be taken says so, because a
 *     silent gap is how an answer becomes confidently wrong.
 *   • **Plain facts, not verdicts.** The brief carries numbers and ages; the
 *     model does the interpreting. Diagnoses belong to `appBrain.diagnose`,
 *     which is where thresholds live.
 */

const log = createLogger("brain-readings");

export type ReadingState = "ok" | "warn" | "critical" | "unknown";

export interface BrainReading {
  id: string;
  /** Grouping the console and the prompt both render under. */
  area: string;
  label: string;
  /** The fact itself, already formatted for a human. */
  value: string;
  state: ReadingState;
  /** Anything the model should not have to infer. */
  detail?: string;
}

export interface BrainReadings {
  generatedAt: string;
  /** How many probes answered. */
  taken: number;
  /** How many could not be taken — the brief says so rather than omitting them. */
  missing: number;
  state: ReadingState;
  readings: BrainReading[];
  /** The brief, ready to paste into a system prompt. */
  text: string;
}

/* ── The probes ──────────────────────────────────────────────────────────── */

const ok = (id: string, area: string, label: string, value: string, detail?: string): BrainReading => ({
  id,
  area,
  label,
  value,
  state: "ok",
  detail,
});

const unknown = (id: string, area: string, label: string, why: string): BrainReading => ({
  id,
  area,
  label,
  value: "unavailable",
  state: "unknown",
  detail: why,
});

function ageLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "never";
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  if (minutes < 60 * 48) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

/**
 * Take every reading we can, in parallel, each caught on its own.
 *
 * `live` adds the outbound checks (our own published feeds). Off by default so a
 * chat question never waits on the public internet.
 */
export async function gatherReadings(opts: { live?: boolean } = {}): Promise<BrainReadings> {
  const readings: BrainReading[] = [];

  const [
    stats,
    hive,
    cron,
    pipeline,
    issues,
    feeds,
    snapshot,
    ai,
    drafts,
    tips,
  ] = await Promise.all([
    neuralMind.getPlatformStats().catch((error) => {
      log.warn("stats reading failed", { error: String(error) });
      return null;
    }),
    hiveBrain.status().catch(() => null),
    getCronStatus().catch(() => null),
    getPipelineHealth().catch(() => null),
    openIssues().catch(() => null),
    prisma.rssFeed
      .findMany({
        select: { name: true, lastPolled: true, lastStatus: true, consecutiveFailures: true, isActive: true },
      })
      .catch(() => null),
    brainOffloadState(),
    getAiConfig().catch(() => null),
    prisma.post.count({ where: { status: "DRAFT" } }).catch(() => null),
    prisma.tip
      .aggregate({ _sum: { amount: true }, _count: { _all: true } })
      .catch(() => null),
  ]);

  /* Audience and content. */
  if (stats) {
    readings.push(
      ok("audience", "Audience", "People", `${stats.totalUsers} total, ${stats.usersThisWeek} joined this week`),
      ok("content", "Content", "Stories", `${stats.totalPosts} published, ${stats.postsThisWeek} this week`),
      ok(
        "engagement",
        "Engagement",
        "Reach",
        `${stats.totalViews.toLocaleString()} views, ${stats.totalComments} comments`
      )
    );
    readings.push(
      stats.pendingModeration > 25
        ? {
            id: "moderation-queue",
            area: "Content",
            label: "Moderation queue",
            value: `${stats.pendingModeration} items waiting`,
            state: "critical",
            detail: "A queue this size is a publication holding back its own writers.",
          }
        : stats.pendingModeration > 5
          ? {
              id: "moderation-queue",
              area: "Content",
              label: "Moderation queue",
              value: `${stats.pendingModeration} items waiting`,
              state: "warn",
            }
          : ok("moderation-queue", "Content", "Moderation queue", `${stats.pendingModeration} items waiting`)
    );

    // Regional depth, only when there is something to report.
    const regions = Object.entries(stats.regionalBreakdown ?? {}).filter(([, v]) => v.users > 0 || v.posts > 0);
    if (regions.length > 0) {
      const top = regions
        .sort((a, b) => b[1].views - a[1].views)
        .slice(0, 3)
        .map(([name, v]) => `${name} ${v.posts} stories / ${v.views.toLocaleString()} views`);
      readings.push(ok("regions", "Audience", "Where the readers are", top.join("; ")));
    }
  } else {
    readings.push(unknown("audience", "Audience", "People", "the platform stats query failed"));
  }

  /* Drafts and currency. */
  if (drafts === null) {
    readings.push(unknown("drafts", "Content", "Drafts", "the draft count query failed"));
  } else {
    readings.push(ok("drafts", "Content", "Drafts in progress", `${drafts} unpublished drafts`));
  }

  if (tips) {
    readings.push(
      ok(
        "economy",
        "Economy",
        "Creator tips",
        `${tips._count._all} tips, ${tips._sum.amount ?? 0} in total`
      )
    );
  } else {
    readings.push(unknown("economy", "Economy", "Creator tips", "the tip ledger could not be read"));
  }

  /* Scheduler — the subsystem whose silence is least visible. */
  if (cron && cron.length > 0) {
    const stale = cron.filter((j) => j.stale);
    const failing = cron.filter((j) => j.lastRun && j.ok === false);
    const essentialStale = stale.filter((j) => j.essential);
    readings.push(
      stale.length === 0
        ? ok("scheduler", "Scheduler", "Scheduled jobs", `all ${cron.length} jobs ran on time`)
        : {
            id: "scheduler",
            area: "Scheduler",
            label: "Scheduled jobs",
            value: `${stale.length} of ${cron.length} behind: ${stale
              .slice(0, 4)
              .map((j) => `${j.id} (${ageLabel(j.ageMinutes)})`)
              .join(", ")}`,
            state: essentialStale.length > 0 ? "critical" : "warn",
            detail: failing.length > 0 ? `${failing.length} of the last runs reported failure.` : undefined,
          }
    );
    const feedPoll = cron.find((j) => j.id.includes("rss") || j.id.includes("poll") || j.id.includes("feed"));
    if (feedPoll) {
      readings.push(
        ok(
          "rss-poll",
          "Syndication",
          "RSS poll",
          `last ran ${ageLabel(feedPoll.ageMinutes)} (every ${feedPoll.everyMinutes}m)${feedPoll.ok ? "" : ", last run failed"}`
        )
      );
    }
  } else {
    readings.push(unknown("scheduler", "Scheduler", "Scheduled jobs", "the heartbeat ledger is unreadable"));
  }

  /* Ingested feeds. */
  if (feeds) {
    const active = feeds.filter((f) => f.isActive);
    const broken = feeds.filter((f) => f.consecutiveFailures >= 3);
    const newest = feeds
      .map((f) => f.lastPolled?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    readings.push(
      broken.length > 0
        ? {
            id: "rss-feeds",
            area: "Syndication",
            label: "Source feeds",
            value: `${active.length} active, ${broken.length} failing repeatedly`,
            state: broken.length > active.length / 2 ? "critical" : "warn",
            detail: broken.slice(0, 4).map((f) => `${f.name} (${f.lastStatus ?? "unknown"})`).join("; "),
          }
        : ok(
            "rss-feeds",
            "Syndication",
            "Source feeds",
            `${active.length} active, newest poll ${ageLabel(newest ? (Date.now() - newest) / 60_000 : null)}`
          )
    );
  } else {
    readings.push(unknown("rss-feeds", "Syndication", "Source feeds", "the feed table could not be read"));
  }

  /* Pipelines — the view fold is the one that makes numbers wrong, not slow. */
  if (pipeline) {
    const bad = pipeline.checks.filter((c) => c.state !== "ok");
    readings.push(
      bad.length === 0
        ? ok("pipelines", "Pipelines", "Background pipelines", `${pipeline.checks.length} checks green`)
        : {
            id: "pipelines",
            area: "Pipelines",
            label: "Background pipelines",
            value: bad.map((c) => `${c.label}: ${c.state}`).join("; "),
            state: bad.some((c) => c.state === "critical") ? "critical" : "warn",
            detail: bad.map((c) => c.detail).join(" | ").slice(0, 400),
          }
    );
  } else {
    readings.push(unknown("pipelines", "Pipelines", "Background pipelines", "pipeline health could not be measured"));
  }

  /*
   * The offload store's health, without reading its high-volume table: the
   * pending-delta count is what the fold job reports, and pulling 500 deltas to
   * answer a chat question would cost more than the answer is worth.
   */
  if (snapshot === null) {
    readings.push(unknown("offload", "Infrastructure", "Offload store", "its state could not be read"));
  } else if (!snapshot.configured) {
    readings.push({
      id: "offload",
      area: "Infrastructure",
      label: "Offload store",
      value: "not configured — views and ad metrics live in Postgres only",
      state: "warn",
    });
  } else if (snapshot.state === "failing") {
    readings.push({
      id: "offload",
      area: "Infrastructure",
      label: "Offload store",
      value: "configured but failing",
      state: "critical",
      detail: snapshot.error ?? "the deployment did not answer",
    });
  } else {
    readings.push(ok("offload", "Infrastructure", "Offload store", "configured and answering"));
  }

  /* The mind itself. */
  if (hive) {
    const newest = hive.recentLearnings?.[0]?.learnedAt ? new Date(hive.recentLearnings[0].learnedAt) : null;
    const hours = newest ? Math.round((Date.now() - newest.getTime()) / 3_600_000) : null;
    readings.push(
      hive.total === 0
        ? {
            id: "hive",
            area: "Mind",
            label: "Hive memory",
            value: "empty",
            state: "warn",
            detail: "Nothing has been learned, so every answer is reasoning without context.",
          }
        : hours !== null && hours > 72
          ? {
              id: "hive",
              area: "Mind",
              label: "Hive memory",
              value: `${hive.total} memories, newest ${hours}h old`,
              state: "warn",
              detail: "The sweep has stopped writing — the mind is running on stale knowledge.",
            }
          : ok("hive", "Mind", "Hive memory", `${hive.total} memories, newest ${ageLabel(hours === null ? null : hours * 60)}`)
    );
  } else {
    readings.push(unknown("hive", "Mind", "Hive memory", "the memory store could not be read"));
  }

  readings.push(
    ai && ai.provider !== "builtin"
      ? ok("model", "Mind", "Writing model", `${ai.provider} configured`, ai.model ? `Model: ${ai.model}` : undefined)
      : {
          id: "model",
          area: "Mind",
          label: "Writing model",
          value: "none configured",
          state: "warn",
          detail: "The deterministic engines answer instead. Configure a provider in Admin → AI for model answers.",
        }
  );

  readings.push(ok("cache", "Infrastructure", "Cache tier", activeCacheBackend() === "none" ? "not configured (Postgres only)" : activeCacheBackend(), activeCacheBackend() === "none" ? "Every render re-reads the database." : undefined));

  /* Findings the mind has already filed against itself. */
  if (issues && issues.length > 0) {
    readings.push({
      id: "issues",
      area: "Health",
      label: "Open brain issues",
      value: `${issues.length} tracked`,
      state: issues.some((i) => i.severity === "critical") ? "critical" : "warn",
      detail: issues
        .slice(0, 5)
        .map((i) => `${i.title} (${i.occurrences}× on ${i.subsystem})`)
        .join("; "),
    });
  } else if (issues) {
    readings.push(ok("issues", "Health", "Open brain issues", "none tracked"));
  }

  /* Our own published feeds — only when asked, because it is outbound. */
  if (opts.live) {
    try {
      const { checkFeedHealth } = await import("@/lib/feed-health");
      const health = await checkFeedHealth({ sample: 2 });
      const bad = health.checks.filter((c) => c.state !== "ok");
      readings.push(
        bad.length === 0
          ? ok("own-feeds", "Syndication", "Our public feeds", `${health.checks.length} feeds healthy`)
          : {
              id: "own-feeds",
              area: "Syndication",
              label: "Our public feeds",
              value: bad.map((c) => `${c.label}: ${c.state}`).join("; "),
              state: health.overall === "critical" ? "critical" : "warn",
            }
      );
    } catch (error) {
      readings.push(unknown("own-feeds", "Syndication", "Our public feeds", String(error)));
    }
  }

  const state: ReadingState = readings.some((r) => r.state === "critical")
    ? "critical"
    : readings.some((r) => r.state === "warn")
      ? "warn"
      : "ok";

  return {
    generatedAt: new Date().toISOString(),
    taken: readings.filter((r) => r.state !== "unknown").length,
    missing: readings.filter((r) => r.state === "unknown").length,
    state,
    readings,
    text: formatReadings(readings),
  };
}

/**
 * Render readings as the brief that goes into a prompt.
 *
 * Pure and exported so the exact wording the model sees is testable — an
 * ungrounded answer is usually a formatting bug in this function, not a model
 * that ignored the facts.
 */
export function formatReadings(readings: BrainReading[]): string {
  if (readings.length === 0) return "No live readings are available right now.";
  const lines = readings.map((r) => {
    const flag = r.state === "unknown" ? " [could not be read]" : r.state === "critical" ? " [CRITICAL]" : r.state === "warn" ? " [degraded]" : "";
    return `• ${r.area} — ${r.label}: ${r.value}${flag}${r.detail ? ` (${r.detail})` : ""}`;
  });
  return [
    "LIVE PLATFORM READINGS (read directly from the platform just now — this is your ground truth;",
    "prefer it over memory or assumption, and say so when a reading could not be taken):",
    ...lines,
  ].join("\n");
}

/**
 * A tiny shape for the offload store so the probe list stays uniform.
 *
 * `convexHealth()` is a cached read — it reports the last call's outcome rather
 * than making one — which is exactly what a chat-time reading should use.
 */
async function brainOffloadState(): Promise<{ configured: boolean; state: string; error?: string | null } | null> {
  try {
    const configured = await convexAvailable();
    const health = convexHealth();
    return { configured, state: health.state, error: health.error };
  } catch {
    return null;
  }
}

/** Aggregate counts the admin console can show without parsing the brief. */
export function summarizeReadings(readings: BrainReading[]): Record<ReadingState, number> {
  return readings.reduce(
    (acc, r) => {
      acc[r.state] += 1;
      return acc;
    },
    { ok: 0, warn: 0, critical: 0, unknown: 0 } as Record<ReadingState, number>
  );
}
