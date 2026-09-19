import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";
import type { BrainDiagnosis, BrainDiagnostic } from "@/lib/app-brain";

/**
 * The brain's issue register.
 *
 * A diagnosis that nobody reads is a log. The point of this module is the step
 * after detection: decide which findings are *real* — a fault that survived
 * three consecutive examinations rather than a blip that was true for one run —
 * and then give each one a lifecycle. It is opened once, updated while it
 * persists, and **closed automatically when it stops appearing**, which is the
 * half most alerting systems omit and the reason a dashboard nobody trusts has
 * twelve stale red rows on it.
 *
 * Three design choices worth stating:
 *
 *  1. **Persistence is measured, not assumed.** A single failed probe is often
 *     a slow query or a cold container. Requiring the same finding id in three
 *     consecutive runs is what separates "the scheduler is stalled" from "the
 *     scheduler was busy when we looked".
 *  2. **Issues live in the platform's own store** (hive memories), so there is
 *     nothing new to migrate and the brain can reason about its own backlog
 *     through the same recall path as everything else.
 *  3. **An external tracker is optional.** A GitHub issue is opened when a token
 *     and repo are configured, and the register works identically without them —
 *     a hard dependency on a tracker is a reason for the wiring to be quietly
 *     disabled in the environment where it would have helped.
 *
 * The classifier is pure and the storage is separate, so the rule that decides
 * what counts as persistent can be tested without a database.
 */

const log = createLogger("brain-issues");

/** Hive-memory identity for an issue row. */
export const ISSUE_SOURCE = "brain-issue";

/** The URI form of a finding's identity — stable across runs and deployments. */
export function issueKey(findingId: string): string {
  return `brain-issue://${findingId}`;
}

/**
 * How many consecutive runs a finding must appear in before it is filed.
 *
 * Three, and the number matters: the nightly diagnosis runs when the platform is
 * quiet, so a one-off is usually a transient upstream, and a two-off is often one
 * long outage straddling two runs. Three consecutive examinations is the first
 * point at which the signal is more likely to be a standing fault than noise.
 */
export const PERSISTENCE_THRESHOLD = 3;

export interface PersistentFinding {
  findingId: string;
  /** How many consecutive most-recent runs contained it, including this one. */
  occurrences: number;
  severity: "warn" | "critical";
  area: string;
  title: string;
  detail: string;
  fix: string;
  /** The part of the platform to look at first — the reason it is filed at all. */
  subsystem: string;
}

/**
 * Which findings have survived long enough to be worth someone's time.
 *
 * `history` is the previous diagnoses, **newest first**, without the current one.
 * Counting stops at the first run that did *not* contain the finding: an issue
 * that appeared, vanished for a night and came back is two problems, not one
 * long one, and treating it as continuous would hide the reappearance.
 */
export function persistentFindings(
  history: BrainDiagnosis[],
  current: BrainDiagnosis,
  threshold = PERSISTENCE_THRESHOLD
): PersistentFinding[] {
  const out: PersistentFinding[] = [];

  for (const finding of current.findings) {
    // Informational findings are notes about configuration, not faults, and an
    // "info" that persists is describing a deliberate setup — not an incident.
    if (finding.severity === "info") continue;

    let occurrences = 1;
    for (const past of history) {
      if (past.findings.some((f) => f.id === finding.id)) occurrences += 1;
      else break;
    }
    if (occurrences < threshold) continue;

    out.push({
      findingId: finding.id,
      occurrences,
      severity: finding.severity,
      area: finding.area,
      title: finding.title,
      detail: finding.detail,
      fix: finding.fix,
      subsystem: subsystemFor(finding),
    });
  }

  return out;
}

/**
 * The subsystem to look at first.
 *
 * Derived from the finding id rather than stored on the finding, because the id
 * *is* the subsystem's name in this codebase — `scheduler-stale` is the cron
 * registry, `pipeline` is the pipeline-health module, `convex` is the offload
 * layer. A map beats a heuristic here: a wrong pointer wastes more time than no
 * pointer at all.
 */
const SUBSYSTEM_BY_FINDING: Record<string, string> = {
  database: "src/lib/prisma.ts · DATABASE_URL",
  "cache-tier": "src/lib/redis.ts · KV_REST_API_URL / REDIS_URL",
  scheduler: "src/lib/job-heartbeat.ts · the heartbeat ledger",
  "scheduler-stale": "src/lib/cron-schedule.ts · Inngest + the edge cron",
  "scheduler-failing": "the failing job's own runner in src/lib/cron-jobs.ts",
  pipeline: "src/lib/pipeline-health.ts",
  convex: "src/lib/convex.ts · convex/",
  hive: "src/lib/hive-brain.ts · the hive sweep job",
  "self-test": "src/lib/writing-checks.ts · src/lib/neural-generate.ts",
  feeds: "src/app/feed.xml/route.ts · src/lib/feeds.ts",
};

export function subsystemFor(finding: Pick<BrainDiagnostic, "id" | "area">): string {
  return SUBSYSTEM_BY_FINDING[finding.id] ?? `unknown — reported under "${finding.area}"`;
}

/* ── The register ─────────────────────────────────────────────────────────── */

export type IssueStatus = "open" | "resolved";

export interface BrainIssue {
  id: string;
  findingId: string;
  status: IssueStatus;
  severity: "warn" | "critical";
  area: string;
  title: string;
  detail: string;
  fix: string;
  subsystem: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  /** Set when the issue was mirrored to an external tracker. */
  externalUrl: string | null;
  externalProvider: "github" | null;
}

interface StoredIssue {
  findingId: string;
  status: IssueStatus;
  severity: "warn" | "critical";
  area: string;
  title: string;
  detail: string;
  fix: string;
  subsystem: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  externalUrl: string | null;
  externalProvider: "github" | null;
}

export interface IssueSyncResult {
  opened: BrainIssue[];
  updated: BrainIssue[];
  resolved: BrainIssue[];
}

/** Read a stored row back into an issue, tolerating a malformed one. */
function rowToIssue(row: { id: string; metadata: string | null; createdAt: Date }): BrainIssue | null {
  if (!row.metadata) return null;
  try {
    const stored = JSON.parse(row.metadata) as StoredIssue;
    if (!stored?.findingId) return null;
    return { id: row.id, ...stored };
  } catch {
    return null;
  }
}

const rowSelect = { id: true, metadata: true, createdAt: true } as const;

/** Open issues, newest activity first — what the console shows by default. */
export async function openIssues(): Promise<BrainIssue[]> {
  const rows = await prisma.neuralMemory.findMany({
    where: { source: ISSUE_SOURCE, category: "open" },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: rowSelect,
  });
  return rows.map(rowToIssue).filter((i): i is BrainIssue => i !== null);
}

/** The issues the brain has closed itself — the record of what it fixed. */
export async function resolvedIssues(limit = 10): Promise<BrainIssue[]> {
  const rows = await prisma.neuralMemory.findMany({
    where: { source: ISSUE_SOURCE, category: "resolved" },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: rowSelect,
  });
  return rows.map(rowToIssue).filter((i): i is BrainIssue => i !== null);
}

async function findOpen(findingId: string) {
  return prisma.neuralMemory.findFirst({
    where: { source: ISSUE_SOURCE, category: "open", sourceUrl: issueKey(findingId) },
    select: { id: true, metadata: true, createdAt: true },
  });
}

async function findResolved(findingId: string) {
  return prisma.neuralMemory.findFirst({
    where: { source: ISSUE_SOURCE, category: "resolved", sourceUrl: issueKey(findingId) },
    orderBy: { updatedAt: "desc" },
    select: { id: true, metadata: true, createdAt: true },
  });
}

/**
 * Reconcile the register against this run's diagnosis.
 *
 * Deliberately a *reconciliation* rather than an append: the register is the set
 * of standing faults, so a run that finds the same fault updates a row instead
 * of adding a second one, and a run that no longer finds it closes the row. The
 * alternative — one row per detection — is how an issue list becomes a log.
 *
 * Returns what changed, so the caller can alert on a newly opened issue (a
 * standing fault deserves a notification; its fifth recurrence does not) and
 * report a closure.
 */
export async function syncIssues(
  current: BrainDiagnosis,
  history: BrainDiagnosis[],
  opts: { external?: boolean } = {}
): Promise<IssueSyncResult> {
  const persistent = persistentFindings(history, current);
  const opened: BrainIssue[] = [];
  const updated: BrainIssue[] = [];
  const resolved: BrainIssue[] = [];
  const now = new Date().toISOString();

  for (const finding of persistent) {
    const existing = await findOpen(finding.findingId).catch(() => null);

    if (existing) {
      const issue = rowToIssue({ ...existing, createdAt: existing.createdAt });
      if (!issue) continue;
      const next: BrainIssue = {
        ...issue,
        severity: finding.severity,
        area: finding.area,
        title: finding.title,
        detail: finding.detail,
        fix: finding.fix,
        subsystem: finding.subsystem,
        occurrences: issue.occurrences + 1,
        lastSeenAt: now,
      };
      await prisma.neuralMemory.update({
        where: { id: existing.id },
        data: { content: issueContent(next), tags: issueTags(next), metadata: JSON.stringify(next) },
      });
      updated.push(next);
      continue;
    }

    // A finding that came back after being closed is reopened on the previous
    // row, so the history — first seen, how many times — survives the closure.
    const previous = await findResolved(finding.findingId).catch(() => null);
    const previousIssue = previous ? rowToIssue({ ...previous, createdAt: previous.createdAt }) : null;

    const issue: BrainIssue = {
      id: previous?.id ?? "",
      findingId: finding.findingId,
      status: "open",
      severity: finding.severity,
      area: finding.area,
      title: finding.title,
      detail: finding.detail,
      fix: finding.fix,
      subsystem: finding.subsystem,
      occurrences: (previousIssue?.occurrences ?? 0) + 1,
      firstSeenAt: previousIssue?.firstSeenAt ?? now,
      lastSeenAt: now,
      resolvedAt: null,
      externalUrl: previousIssue?.externalUrl ?? null,
      externalProvider: previousIssue?.externalProvider ?? null,
    };

    if (opts.external !== false && !issue.externalUrl) {
      const external = await openExternalIssue(issue).catch(() => null);
      if (external) {
        issue.externalUrl = external.url;
        issue.externalProvider = external.provider;
      }
    }

    const row = previous
      ? await prisma.neuralMemory.update({
          where: { id: previous.id },
          data: {
            category: "open",
            content: issueContent(issue),
            tags: issueTags(issue),
            metadata: JSON.stringify(issue),
          },
          select: { id: true },
        })
      : await prisma.neuralMemory.create({
          data: {
            source: ISSUE_SOURCE,
            category: "open",
            sourceUrl: issueKey(finding.findingId),
            content: issueContent(issue),
            tags: issueTags(issue),
            confidence: 0.7,
            metadata: JSON.stringify(issue),
          },
          select: { id: true },
        });

    opened.push({ ...issue, id: row.id });
  }

  /* Close anything that is no longer being detected. */
  const stillOpen = await openIssues().catch(() => [] as BrainIssue[]);
  const seen = new Set(persistent.map((p) => p.findingId));
  for (const issue of stillOpen) {
    if (seen.has(issue.findingId)) continue;
    // Only close what this run had a chance to see: a probe that could not run
    // at all (`healthy` does not contain it, and no finding was raised) is not
    // evidence that the fault is gone. See `diagnosisCovered`.
    if (!coveredByDiagnosis(current, issue.findingId)) continue;

    const closed: BrainIssue = { ...issue, status: "resolved", resolvedAt: now };
    await prisma.neuralMemory
      .update({
        where: { id: issue.id },
        data: {
          category: "resolved",
          content: issueContent(closed),
          tags: issueTags(closed),
          metadata: JSON.stringify(closed),
        },
      })
      .catch(() => {});
    resolved.push(closed);
  }

  if (opened.length || updated.length || resolved.length) {
    log.info("issue register reconciled", {
      opened: opened.map((i) => i.findingId),
      updated: updated.map((i) => i.findingId),
      resolved: resolved.map((i) => i.findingId),
    });
  }

  return { opened, updated, resolved };
}

/**
 * Whether this run actually examined the subsystem a finding belongs to.
 *
 * Without this the register would close every issue on any run that came back
 * clean because a probe was *skipped* — a healthy report for a subsystem nobody
 * looked at is not a fix, and silently closing a real issue is worse than
 * leaving it open a night too long.
 */
function coveredByDiagnosis(diagnosis: BrainDiagnosis, findingId: string): boolean {
  return diagnosis.healthy.includes(findingId) || diagnosis.findings.some((f) => f.id === findingId);
}

function issueContent(issue: BrainIssue): string {
  return `[${issue.severity}] ${issue.title} — ${issue.detail} (seen ${issue.occurrences}×, first ${issue.firstSeenAt})`;
}

function issueTags(issue: BrainIssue): string {
  return ["issue", issue.status, issue.severity, issue.findingId, issue.subsystem].join(",");
}

/** Manually close an issue from the console. */
export async function closeIssue(id: string, reason?: string): Promise<boolean> {
  const row = await prisma.neuralMemory
    .findUnique({ where: { id }, select: rowSelect })
    .catch(() => null);
  if (!row) return false;
  const issue = rowToIssue(row);
  if (!issue) return false;

  const closed: BrainIssue = {
    ...issue,
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    detail: reason ? `${issue.detail}\n\nClosed by an admin: ${reason}` : issue.detail,
  };
  await prisma.neuralMemory.update({
    where: { id },
    data: {
      category: "resolved",
      content: issueContent(closed),
      tags: issueTags(closed),
      metadata: JSON.stringify(closed),
    },
  });
  return true;
}

/* ── Optional external tracker ────────────────────────────────────────────── */

/**
 * Mirror an issue into GitHub Issues, when the deployment has the credentials.
 *
 * This is the "tracked issue" in the literal sense — a thing with a number that
 * can be assigned, referenced in a commit and closed. It is strictly optional:
 * the register above is complete without it, and the call site catches every
 * failure, because an unreachable tracker must not cost the diagnosis its
 * findings.
 */
export async function openExternalIssue(
  issue: BrainIssue
): Promise<{ url: string; provider: "github" } | null> {
  const token = (process.env.GITHUB_ISSUES_TOKEN ?? "").trim();
  const repo = (process.env.GITHUB_ISSUES_REPO ?? "").trim();
  if (!token || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;

  const body = [
    `**Detected by the ConnectPlus Brain** — seen in ${issue.occurrences} consecutive self-diagnoses.`,
    "",
    `| | |`,
    `| --- | --- |`,
    `| Finding | \`${issue.findingId}\` |`,
    `| Severity | ${issue.severity} |`,
    `| Area | ${issue.area} |`,
    `| First seen | ${issue.firstSeenAt} |`,
    `| Last seen | ${issue.lastSeenAt} |`,
    "",
    "**Evidence**",
    "",
    "```",
    issue.detail.slice(0, 4_000),
    "```",
    "",
    "**Suspect subsystem**",
    "",
    `\`${issue.subsystem}\``,
    "",
    "**Suggested fix**",
    "",
    issue.fix,
    "",
    "_The issue closes itself when a later diagnosis stops finding it._",
  ].join("\n");

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "connectplus-brain",
    },
    body: JSON.stringify({
      title: `[brain] ${issue.title}`,
      body,
      labels: ["brain-diagnosis", issue.severity === "critical" ? "severity:critical" : "severity:warn"],
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    log.warn("github issue could not be opened", { status: res.status, finding: issue.findingId });
    return null;
  }
  const data = (await res.json().catch(() => null)) as { html_url?: string } | null;
  if (!data?.html_url) return null;
  log.info("github issue opened", { finding: issue.findingId, url: data.html_url });
  return { url: data.html_url, provider: "github" };
}
