import { NextResponse } from "next/server";
import { runChecks, recordAndReadHistory, fetchCronRuns, type StatusResponse } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Small in-memory cache so multiple open tabs share one probe round. */
const CACHE_MS = 15_000;
let memo: { expiresAt: number; data: StatusResponse } | null = null;

export async function GET() {
  if (memo && memo.expiresAt > Date.now()) {
    return NextResponse.json(memo.data);
  }

  const [checks, crons] = await Promise.all([
    runChecks(),
    fetchCronRuns().catch(() => []),
  ]);
  const history = await recordAndReadHistory(checks.services);

  const data: StatusResponse = { ...checks, history, crons };
  memo = { expiresAt: Date.now() + CACHE_MS, data };
  return NextResponse.json(data);
}