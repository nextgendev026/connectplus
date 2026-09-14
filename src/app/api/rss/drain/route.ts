import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { inngest } from "@/lib/inngest";
import { createLogger } from "@/lib/logger";
import { newDrainRunId, seedDrain } from "@/lib/rss-drain";
import { hasSharedSecret } from "@/lib/shared-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("rss-drain");

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
 * POST /api/rss/drain
 *
 * Starts a whole-registry drain. When Inngest is linked the work is handed to
 * the `rss-drain` function (one step per feed) and the response tells the
 * console to tail `/api/rss/drain/stream?runId=…`. Without an event key we
 * return `{ mode: "inline" }` so the console falls back to the original
 * batched `/api/rss/stream` path — the feature never depends on the queue.
 */
export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const runId = newDrainRunId();
  await seedDrain(runId);

  if (process.env.INNGEST_EVENT_KEY) {
    try {
      const sent = await inngest.send({ name: "rss-drain", data: { runId } });
      const ids = (sent as { ids?: string[] } | undefined)?.ids ?? [];
      if (ids.length > 0) {
        return NextResponse.json({ mode: "inngest", runId, eventIds: ids });
      }
      log.warn("rss-drain event accepted nothing; falling back to inline");
    } catch (err) {
      log.warn("rss-drain send failed; falling back to inline", { error: err });
    }
  }

  return NextResponse.json({ mode: "inline", runId });
}
