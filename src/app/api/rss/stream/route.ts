import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { pollFeeds, recoverMissingThumbnails } from "@/lib/rss-poll";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const log = createLogger("rss-stream");

/**
 * Server-sent progress for the two long-running ingestion jobs, consumed by the
 * admin console's loading bar.
 *
 *   GET /api/rss/stream?action=poll[&feedId=...]
 *   GET /api/rss/stream?action=thumbnails[&limit=25&network=1]
 *
 * Responds with newline-delimited JSON so the client can paint progress as it
 * happens:
 *   {"type":"start","total":11}
 *   {"type":"feed","index":3,"total":11,"name":"Nairobi Wire","status":"OK","newArticles":4}
 *   {"type":"done","summary":{...}}
 *
 * Access is either an ADMIN/SUPER_ADMIN session (the console) or a
 * `CRON_SECRET` bearer token (ops/cron), so the same pipeline can be driven
 * headlessly.
 */
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

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const action = request.nextUrl.searchParams.get("action") ?? "poll";
  const feedId = request.nextUrl.searchParams.get("feedId") ?? undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "25");
  const network = request.nextUrl.searchParams.get("network") !== "0";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        } catch {
          /* client went away */
        }
      };

      try {
        if (action === "thumbnails") {
          send({ type: "start", total: limit, action });
          const summary = await recoverMissingThumbnails({
            limit,
            network,
            onProgress: (p) =>
              send({
                type: "item",
                index: p.index,
                total: p.total,
                name: p.label,
                status: p.recovered ? p.source.toUpperCase() : "NONE",
                newArticles: p.recovered ? 1 : 0,
              }),
          });
          send({ type: "done", summary });
        } else {
          send({ type: "start", total: 0, action });
          const summary = await pollFeeds(feedId, ({ index, total, summary: feed }) =>
            send({
              type: "feed",
              index,
              total,
              name: feed.feedName,
              status: feed.status ?? (feed.error ? "ERROR" : "OK"),
              newArticles: feed.newArticles,
              items: feed.itemCount,
              durationMs: feed.durationMs,
              error: feed.error,
            })
          );
          send({ type: "done", summary });
        }
      } catch (err) {
        log.error("rss stream failed", { error: err });
        send({ type: "error", message: err instanceof Error ? err.message : "Stream failed" });
      } finally {
        controller.close();
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
