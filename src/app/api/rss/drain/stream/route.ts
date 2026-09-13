import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { readDrainState } from "@/lib/rss-drain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("rss-drain-stream");

async function authorize(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  if (secret && header === `Bearer ${secret}`) return true;
  if (secret && request.nextUrl.searchParams.get("key") === secret) return true;
  try {
    const session = await auth();
    const role = session?.user?.role;
    return role === "ADMIN" || role === "SUPER_ADMIN";
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET /api/rss/drain/stream?runId=…
 *
 * Tails the Redis progress ledger the Inngest drain writes, emitting the same
 * NDJSON events the inline `/api/rss/stream` route does — so the console's
 * progress bar is unchanged whichever path is running. Read-only and bounded
 * (the route's 300s ceiling); the drain itself keeps going in Inngest even if
 * the viewer closes the tab.
 */
export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const runId = request.nextUrl.searchParams.get("runId");
  if (!runId) {
    return new Response(JSON.stringify({ error: "runId is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          /* viewer went away */
        }
      };

      const deadline = Date.now() + 290_000;
      let emitted = 0;
      let announcedWaiting = false;

      try {
        send({ type: "start", total: 0, action: "drain", runId });

        while (Date.now() < deadline) {
          const state = await readDrainState(runId);
          if (!state) {
            if (!announcedWaiting) {
              announcedWaiting = true;
              send({ type: "waiting", message: "Queued for the background worker…" });
            }
          } else {
            for (let i = emitted; i < state.events.length; i++) {
              const e = state.events[i];
              if (!e) continue;
              send({
                type: "feed",
                index: i + 1,
                total: state.total,
                name: e.name,
                status: e.status,
                newArticles: e.newArticles,
                items: e.items,
                durationMs: e.durationMs,
                error: e.error,
              });
            }
            emitted = state.events.length;

            if (state.stage === "done" || state.stage === "cancelled") {
              send({
                type: "done",
                summary: {
                  feedsPolled: state.index,
                  newArticles: state.newArticles,
                  errors: state.errors,
                  dueTotal: state.total,
                  dueRemaining: state.dueRemaining,
                  cancelled: state.stage === "cancelled",
                  mode: "inngest",
                },
              });
              controller.close();
              return;
            }
          }
          await sleep(1000);
        }

        send({ type: "error", message: "Timed out watching the drain — re-run to see progress." });
      } catch (err) {
        log.error("drain stream failed", { runId, error: err });
        send({ type: "error", message: err instanceof Error ? err.message : "Stream failed" });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
