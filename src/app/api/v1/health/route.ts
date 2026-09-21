import { API_VERSION, apiHandler, okResponse } from "@/lib/contracts";

/**
 * `GET /api/v1/health` — the versioned API is up, and this is what it is.
 *
 * Distinct from `/api/status`, which is an admin-facing deep probe of every
 * subsystem. This answers the two questions a *client* has: is the API I was
 * built against still here, and what does it call itself. It touches no
 * database and no cache on purpose — a liveness check that can fail because
 * Postgres is slow is a liveness check that pages someone at 3am for nothing.
 */

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (_req, ctx) =>
  okResponse(
    {
      status: "ok" as const,
      apiVersion: API_VERSION,
      /** Echoed back so a misconfigured client is diagnosable from its own logs. */
      clientPlatform: ctx.platform,
      clientVersion: ctx.clientVersion,
      locale: ctx.locale,
    },
    ctx
  )
);
