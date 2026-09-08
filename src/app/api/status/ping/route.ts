import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkInngest, type ServiceStatus } from "@/lib/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Minimal health probe for external uptime monitors (UptimeRobot, Better
 * Stack, cron-job.org…). Deliberately does NOT probe radio/forex/weather —
 * those third parties being down shouldn't page anyone about OUR platform.
 * Returns 200 operational, 503 when the database (the core service) is down.
 */
export async function GET() {
  const started = Date.now();
  let db: ServiceStatus = "down";
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "operational";
  } catch {
    db = "down";
  }
  const inngest = checkInngest();

  const degraded = db === "down" || inngest.status === "degraded";
  const body = {
    status: db === "operational" && inngest.status !== "down" ? (degraded ? "degraded" : "operational") : "down",
    db,
    jobs: inngest.status,
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: db === "down" ? 503 : 200 });
}