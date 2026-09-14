import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { requestDrainCancel } from "@/lib/rss-drain";
import { hasSharedSecret } from "@/lib/shared-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("rss-drain-cancel");

async function authorize(request: NextRequest): Promise<boolean> {
  if (hasSharedSecret(request)) return true;
  try {
    const session = await auth();
    const role = session?.user?.role;
    return role === "ADMIN" || role === "SUPER_ADMIN";
  } catch {
    return false;
  }
}

/**
 * POST /api/rss/drain/cancel  { runId }
 *
 * Cooperative cancel: sets the flag the Inngest run checks between feeds.
 * Feeds already polled stay polled; the remainder stay due, so the next drain
 * resumes from there rather than starting over.
 */
export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { runId?: string };
  const runId = body.runId;
  if (!runId) return NextResponse.json({ error: "runId is required" }, { status: 400 });

  await requestDrainCancel(runId);
  log.info("drain cancel requested", { runId });
  return NextResponse.json({ ok: true, runId, cancelled: true });
}
