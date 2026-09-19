import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { neuralMind } from "@/lib/neural-mind";
import { hiveBrain } from "@/lib/hive-brain";
import { marketAccuracy, loadMindCorpus, PRIMARY_MODEL, MIND_MIN_LESSONS } from "@/lib/sports-intelligence";
import { listDirectives } from "@/lib/mind-directives";
import { getPipelineHealth } from "@/lib/pipeline-health";
import { openIssues } from "@/lib/brain-issues";
import { pendingProposalCount } from "@/lib/brain-approvals";

/**
 * The brain's awareness of every domain it is responsible for.
 *
 * `brain-readings` answers "what is the number right now" — it is the brief a
 * question is grounded in. This answers a different question: **"how well is the
 * mind calibrated in each domain, and what has it learned?"** Those are not the
 * same thing, and the admin console needs both. A reading says the scheduler is
 * behind; awareness says the sports model is running on 11 lessons against a
 * minimum of 3, that its 1X2 market is 58% over 40 settled picks, and that two
 * standing directives are leaning its home calls by 0.15.
 *
 * Three properties, deliberately:
 *
 *   • **Read-only.** Every probe here is a SELECT. That is what lets the console
 *     show the whole mind without an approval in the way.
 *   • **Honest about thin evidence.** A model with 2 lessons and an accuracy of
 *     0 from 3 settled picks is reported as *unproven*, not as 0% right. The
 *     distinction matters: the second reading would make an operator switch off
 *     a model that has barely been tested.
 *   • **Each domain fails alone.** A domain that cannot be measured reports
 *     `unknown` with the reason, so a gap is visible instead of looking calm.
 */

const log = createLogger("brain-awareness");

export type AwarenessState = "ok" | "warn" | "critical" | "unknown" | "unproven";

export interface AwarenessFact {
  label: string;
  value: string;
}

export interface AwarenessDomain {
  id: string;
  label: string;
  /** One line the console renders as the domain's headline. */
  headline: string;
  state: AwarenessState;
  facts: AwarenessFact[];
  /** What the mind has learned here, in its own words. */
  notes: string[];
}

export interface BrainAwareness {
  generatedAt: string;
  domains: AwarenessDomain[];
  /** Domains the mind is confident in, and those it is still learning. */
  summary: { calibrated: number; learning: number; unknown: number };
}

const unknownDomain = (id: string, label: string, why: string): AwarenessDomain => ({
  id,
  label,
  headline: "Not measurable right now",
  state: "unknown",
  facts: [],
  notes: [why],
});

/* ── Sports: the domain where calibration is most measurable ─────────────── */

async function sportsDomain(): Promise<AwarenessDomain> {
  const [corpus, accuracy, pending, settled] = await Promise.all([
    loadMindCorpus(400).catch(() => []),
    marketAccuracy().catch(() => ({}) as Record<string, { accuracy: number; sample: number }>),
    prisma.sportsPrediction.count({ where: { status: "PENDING" } }).catch(() => 0),
    prisma.sportsPrediction
      .count({ where: { status: { in: ["WON", "LOST"] } } })
      .catch(() => 0),
  ]);

  const lessons = corpus.length;
  const markets = Object.entries(accuracy).filter(([, v]) => v.sample > 0);
  const totalSample = markets.reduce((sum, [, v]) => sum + v.sample, 0);
  const weighted = markets.reduce((sum, [, v]) => sum + v.accuracy * v.sample, 0);
  const overall = totalSample > 0 ? weighted / totalSample : null;

  const facts: AwarenessFact[] = [
    { label: "Model", value: PRIMARY_MODEL },
    { label: "Learned lessons", value: `${lessons} in the sports corpus` },
    { label: "Settled picks", value: `${settled} graded` },
    { label: "Open picks", value: `${pending} awaiting a result` },
  ];
  for (const [market, v] of markets) {
    facts.push({
      label: market,
      value: `${Math.round(v.accuracy * 100)}% over ${v.sample} settled`,
    });
  }

  const notes: string[] = [];
  let state: AwarenessState;

  if (lessons < MIND_MIN_LESSONS) {
    // The mind is explicitly not allowed to move a prediction below this
    // threshold — saying "learning" is the accurate report.
    state = "unproven";
    notes.push(
      `Only ${lessons} lessons in the corpus (the model needs ${MIND_MIN_LESSONS} before the mind may move a prediction). Predictions are running on the base model.`
    );
  } else if (totalSample < 10) {
    state = "unproven";
    notes.push(
      `${lessons} lessons loaded and folding into predictions, but only ${totalSample} settled picks — too few to judge accuracy.`
    );
  } else if (overall !== null && overall >= 0.5) {
    state = "ok";
    notes.push(
      `Running on ${lessons} lessons with ${Math.round(overall * 100)}% accuracy across ${totalSample} settled picks.`
    );
  } else {
    state = "warn";
    notes.push(
      `Accuracy is ${Math.round((overall ?? 0) * 100)}% across ${totalSample} settled picks — below chance. Check the directives below before trusting the next calls.`
    );
  }

  /* Standing directives are the operator's own calibration, so they belong here. */
  const directives = await listDirectives(false).catch(() => []);
  if (directives.length > 0) {
    facts.push({ label: "Standing directives", value: `${directives.length} active` });
    for (const d of directives.slice(0, 4)) {
      notes.push(`Directive: “${d.raw.slice(0, 120)}” — lean ${d.lean.toFixed(2)}, goals bias ${d.goalsBias.toFixed(2)}.`);
    }
  }

  return {
    id: "sports",
    label: "Sports prediction",
    headline:
      state === "ok"
        ? `Calibrated on ${lessons} lessons, ${Math.round((overall ?? 0) * 100)}% accuracy`
        : state === "unproven"
          ? "Still learning — running on the base model"
          : state === "warn"
            ? "Accuracy below chance — review the directives"
            : "Not measurable right now",
    state,
    facts,
    notes,
  };
}

/* ── Audience and growth ─────────────────────────────────────────────────── */

async function audienceDomain(): Promise<AwarenessDomain> {
  const stats = await neuralMind.getPlatformStats().catch(() => null);
  if (!stats) return unknownDomain("audience", "Audience", "The platform stats query failed.");

  const regions = Object.entries(stats.regionalBreakdown ?? {}).filter(([, v]) => v.users > 0 || v.posts > 0);
  const topRegion = regions.sort((a, b) => b[1].views - a[1].views)[0];

  const facts: AwarenessFact[] = [
    { label: "People", value: `${stats.totalUsers} total` },
    { label: "Joined this week", value: String(stats.usersThisWeek) },
    { label: "Stories published", value: String(stats.totalPosts) },
    { label: "Views", value: stats.totalViews.toLocaleString() },
    { label: "Comments", value: String(stats.totalComments) },
  ];
  if (topRegion) {
    facts.push({ label: "Strongest region", value: `${topRegion[0]} (${topRegion[1].views.toLocaleString()} views)` });
  }

  const notes: string[] = [];
  if (stats.usersThisWeek === 0 && stats.postsThisWeek === 0) {
    notes.push("No new people and no new stories this week — growth is flat.");
  } else {
    notes.push(`${stats.usersThisWeek} joined and ${stats.postsThisWeek} stories published this week.`);
  }
  if (stats.pendingModeration > 5) {
    notes.push(`${stats.pendingModeration} items are waiting in moderation — a queue this size holds writers back.`);
  }

  return {
    id: "audience",
    label: "Audience and growth",
    headline: `${stats.totalUsers} people · ${stats.totalViews.toLocaleString()} views`,
    state: stats.usersThisWeek === 0 && stats.postsThisWeek === 0 ? "warn" : "ok",
    facts,
    notes,
  };
}

/* ── Economy ─────────────────────────────────────────────────────────────── */

async function economyDomain(): Promise<AwarenessDomain> {
  const [tips, subscriptions, payouts] = await Promise.all([
    prisma.tip.aggregate({ _sum: { amount: true }, _count: { _all: true } }).catch(() => null),
    prisma.userSubscription.count({ where: { status: "ACTIVE" } }).catch(() => null),
    prisma.creatorPayout.count({ where: { status: "PENDING" } }).catch(() => null),
  ]);
  if (tips === null && subscriptions === null) {
    return unknownDomain("economy", "Economy", "The payment ledger could not be read.");
  }

  const facts: AwarenessFact[] = [];
  if (subscriptions !== null) facts.push({ label: "Active subscriptions", value: String(subscriptions) });
  if (tips) {
    facts.push({ label: "Tips", value: `${tips._count._all} worth ${tips._sum.amount ?? 0}` });
  }
  if (payouts !== null) facts.push({ label: "Payouts waiting", value: String(payouts) });

  const notes: string[] = [];
  if (payouts !== null && payouts > 0) {
    notes.push(`${payouts} creator payouts are waiting — money owed but not sent is the fastest way to lose a writer.`);
  }
  if (subscriptions === 0) notes.push("No active subscriptions. The paid tier has not converted yet.");

  return {
    id: "economy",
    label: "Economy",
    headline:
      subscriptions !== null && subscriptions > 0
        ? `${subscriptions} active subscriptions`
        : "No active subscriptions",
    state:
      payouts !== null && payouts > 0 ? "warn" : subscriptions === 0 ? "warn" : "ok",
    facts,
    notes,
  };
}

/* ── The mind itself ─────────────────────────────────────────────────────── */

async function mindDomain(): Promise<AwarenessDomain> {
  const [hive, proposals, issues] = await Promise.all([
    hiveBrain.status().catch(() => null),
    pendingProposalCount().catch(() => 0),
    openIssues().catch(() => []),
  ]);
  if (!hive) return unknownDomain("mind", "Mind", "The memory store could not be read.");

  const newest = hive.recentLearnings?.[0]?.learnedAt ? new Date(hive.recentLearnings[0].learnedAt) : null;
  const ageMinutes = newest ? Math.round((Date.now() - newest.getTime()) / 60_000) : null;

  const facts: AwarenessFact[] = [
    { label: "Memories", value: hive.total.toLocaleString() },
    { label: "Newest lesson", value: ageMinutes === null ? "never" : ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.round(ageMinutes / 60)}h ago` },
    { label: "Awaiting approval", value: `${proposals} write request${proposals === 1 ? "" : "s"}` },
    { label: "Open issues", value: `${issues.length} tracked` },
  ];

  const notes: string[] = [];
  if (ageMinutes !== null && ageMinutes > 60 * 24) {
    notes.push(`The newest lesson is ${Math.round(ageMinutes / 60 / 24)} days old — the sweep has stopped writing, so answers are running on stale knowledge.`);
  }
  if (hive.total === 0) notes.push("The hive is empty. Nothing has been learned, so every answer is reasoning without context.");
  if (proposals > 0) notes.push(`${proposals} write request${proposals === 1 ? "" : "s"} awaiting a decision.`);

  return {
    id: "mind",
    label: "Mind",
    headline: `${hive.total.toLocaleString()} memories · ${proposals} awaiting approval`,
    state:
      hive.total === 0 || (ageMinutes !== null && ageMinutes > 60 * 24) ? "warn" : "ok",
    facts,
    notes,
  };
}

/* ── Pipelines ───────────────────────────────────────────────────────────── */

async function pipelineDomain(): Promise<AwarenessDomain> {
  const pipeline = await getPipelineHealth().catch(() => null);
  if (!pipeline) return unknownDomain("pipelines", "Pipelines", "Pipeline health could not be measured.");

  const bad = pipeline.checks.filter((c) => c.state !== "ok");
  const facts: AwarenessFact[] = [
    { label: "Checks", value: `${pipeline.checks.length} total, ${bad.length} not green` },
  ];
  for (const check of pipeline.checks.slice(0, 5)) {
    facts.push({ label: check.label, value: check.state });
  }

  return {
    id: "pipelines",
    label: "Pipelines",
    headline: bad.length === 0 ? "All pipelines green" : `${bad.length} pipeline${bad.length === 1 ? "" : "s"} degraded`,
    state: bad.some((c) => c.state === "critical") ? "critical" : bad.length > 0 ? "warn" : "ok",
    facts,
    notes: bad.slice(0, 3).map((c) => `${c.label}: ${c.detail}`),
  };
}

/**
 * Every domain, each caught on its own.
 *
 * The domains run in parallel and independently: a payment-ledger failure must
 * not cost the console its view of sports calibration, because those are
 * different problems with different fixes.
 */
export async function gatherAwareness(): Promise<BrainAwareness> {
  const settled = await Promise.allSettled([
    sportsDomain(),
    audienceDomain(),
    economyDomain(),
    mindDomain(),
    pipelineDomain(),
  ]);

  const ids = ["sports", "audience", "economy", "mind", "pipelines"];
  const labels = ["Sports prediction", "Audience and growth", "Economy", "Mind", "Pipelines"];
  const domains: AwarenessDomain[] = settled.map((result, index) => {
    if (result.status === "fulfilled") return result.value;
    log.warn("awareness domain failed", { domain: ids[index], error: String(result.reason) });
    return unknownDomain(ids[index]!, labels[index]!, String(result.reason));
  });

  return {
    generatedAt: new Date().toISOString(),
    domains,
    summary: {
      calibrated: domains.filter((d) => d.state === "ok").length,
      learning: domains.filter((d) => d.state === "warn" || d.state === "unproven").length,
      unknown: domains.filter((d) => d.state === "unknown").length,
    },
  };
}

/** The one-line version, for the chat's context block. */
export function formatAwareness(awareness: BrainAwareness): string {
  return awareness.domains
    .map((d) => `${d.label}: ${d.headline}${d.state === "unknown" ? " [could not be read]" : d.state === "warn" ? " [degraded]" : d.state === "unproven" ? " [unproven]" : ""}`)
    .join("\n");
}
