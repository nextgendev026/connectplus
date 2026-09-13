import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { redisGetRaw, redisSetEx } from "@/lib/redis";

/**
 * Progress + history for the whole-registry RSS drain.
 *
 * The drain runs in Inngest, one step per feed, so a slow source or a
 * serverless window ending mid-run no longer costs the whole cycle. Two layers
 * back it:
 *
 *   • Redis  — the live progress ledger the console tails over NDJSON. Short
 *              TTL, single writer (the Inngest run), read-only consumers.
 *   • Postgres — durable `RssDrainRun` + `RssDrainFeed` rows written as each
 *              step completes, so "which feeds failed last night?" is still
 *              answerable after Redis expires and the tab is long closed.
 *
 * Cancellation is cooperative: the console sets a flag, and the run checks it
 * between feeds. Feeds already processed stay processed; the rest remain due
 * (their lastPolled was never advanced), so a later drain simply picks them up.
 */

export interface DrainFeedEvent {
  name: string;
  status: string;
  newArticles: number;
  items?: number;
  durationMs?: number;
  error?: string;
}

export type DrainStage = "queued" | "running" | "done" | "cancelled";

export interface DrainState {
  runId: string;
  stage: DrainStage;
  total: number;
  index: number;
  startedAt: string;
  finishedAt?: string;
  newArticles: number;
  errors: number;
  events: DrainFeedEvent[];
  /** Always 0 for a full-registry drain; kept for parity with the inline path. */
  dueRemaining: number;
}

const TTL_SECONDS = 3_600;

export function drainKey(runId: string): string {
  return `rss:drain:${runId}`;
}

function cancelKey(runId: string): string {
  return `rss:drain:cancel:${runId}`;
}

export function newDrainRunId(): string {
  return randomUUID();
}

export async function readDrainState(runId: string): Promise<DrainState | null> {
  const raw = await redisGetRaw(drainKey(runId)).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DrainState;
  } catch {
    return null;
  }
}

export async function writeDrainState(state: DrainState): Promise<void> {
  await redisSetEx(drainKey(state.runId), TTL_SECONDS, JSON.stringify(state)).catch(() => {});
}

/** Create both the Redis ledger and the durable run row. */
export async function seedDrain(runId: string): Promise<void> {
  await writeDrainState({
    runId,
    stage: "queued",
    total: 0,
    index: 0,
    startedAt: new Date().toISOString(),
    newArticles: 0,
    errors: 0,
    events: [],
    dueRemaining: 0,
  });
  await prisma.rssDrainRun
    .create({ data: { id: runId, stage: "queued" } })
    .catch(() => null);
}

/** Called by the Inngest run once it knows how many feeds are due. */
export async function startDrain(runId: string, total: number): Promise<DrainState> {
  const existing = await readDrainState(runId);
  const state: DrainState = {
    runId,
    stage: "running",
    total,
    index: 0,
    startedAt: existing?.startedAt ?? new Date().toISOString(),
    newArticles: 0,
    errors: 0,
    events: [],
    dueRemaining: 0,
  };
  await writeDrainState(state);
  await prisma.rssDrainRun
    .upsert({
      where: { id: runId },
      create: { id: runId, stage: "running", total },
      update: { stage: "running", total },
    })
    .catch(() => null);
  return state;
}

/** Append one feed's outcome to both the live ledger and the durable history. */
export async function recordDrainFeed(
  runId: string,
  event: DrainFeedEvent,
  index: number,
  feedId?: string
): Promise<void> {
  const state = await readDrainState(runId);
  if (state) {
    state.stage = "running";
    state.index = index;
    state.events.push(event);
    state.newArticles += event.newArticles;
    if (event.error) state.errors += 1;
    await writeDrainState(state);
  }

  await prisma.rssDrainFeed
    .create({
      data: {
        runId,
        feedId: feedId ?? null,
        feedName: event.name,
        status: event.status,
        newArticles: event.newArticles,
        items: event.items ?? null,
        durationMs: event.durationMs ?? null,
        error: event.error ?? null,
      },
    })
    .catch(() => null);
}

export async function finishDrain(
  runId: string,
  summary: { total: number; newArticles: number; errors: number; dueRemaining?: number; cancelled?: boolean }
): Promise<void> {
  const state = await readDrainState(runId);
  const stage: DrainStage = summary.cancelled ? "cancelled" : "done";
  if (state) {
    state.stage = stage;
    state.total = summary.total;
    state.index = Math.max(state.index, state.events.length);
    state.newArticles = summary.newArticles;
    state.errors = summary.errors;
    state.dueRemaining = summary.dueRemaining ?? 0;
    state.finishedAt = new Date().toISOString();
    await writeDrainState(state);
  }

  await prisma.rssDrainRun
    .update({
      where: { id: runId },
      data: {
        stage,
        total: summary.total,
        processed: state?.index ?? 0,
        newArticles: summary.newArticles,
        errors: summary.errors,
        cancelled: Boolean(summary.cancelled),
        finishedAt: new Date(),
      },
    })
    .catch(() => null);
}

export async function failDrain(runId: string, message: string): Promise<void> {
  const state = (await readDrainState(runId)) ?? {
    runId,
    stage: "running" as const,
    total: 0,
    index: 0,
    startedAt: new Date().toISOString(),
    newArticles: 0,
    errors: 0,
    events: [],
    dueRemaining: 0,
  };
  state.stage = "done";
  state.finishedAt = new Date().toISOString();
  state.errors += 1;
  state.events.push({ name: "drain", status: "ERROR", newArticles: 0, error: message });
  await writeDrainState(state);

  await prisma.rssDrainRun
    .update({ where: { id: runId }, data: { stage: "done", errors: state.errors, finishedAt: new Date() } })
    .catch(() => null);
}

/** Console-triggered cancel: set the flag the run checks between feeds. */
export async function requestDrainCancel(runId: string): Promise<void> {
  await redisSetEx(cancelKey(runId), TTL_SECONDS, new Date().toISOString()).catch(() => {});
  await prisma.rssDrainRun
    .update({ where: { id: runId }, data: { cancelled: true } })
    .catch(() => null);
}

export async function isDrainCancelled(runId: string): Promise<boolean> {
  const flag = await redisGetRaw(cancelKey(runId)).catch(() => null);
  if (flag) return true;
  // Redis may be unavailable; fall back to the durable flag.
  const run = await prisma.rssDrainRun.findUnique({ where: { id: runId }, select: { cancelled: true } }).catch(() => null);
  return Boolean(run?.cancelled);
}

/** Recent runs with their per-feed outcomes, for the console's history view. */
export async function recentDrainRuns(limit = 5) {
  const runs = await prisma.rssDrainRun
    .findMany({
      orderBy: { startedAt: "desc" },
      take: Math.min(Math.max(limit, 1), 20),
      include: { feeds: { orderBy: { createdAt: "asc" } } },
    })
    .catch(() => []);
  return runs;
}
