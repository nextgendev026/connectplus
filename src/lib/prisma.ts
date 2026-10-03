import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { isCloudflareWorkers } from "./prisma-adapter";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Build the client for whichever runtime we are on.
 *
 * On Node (local dev, the CI test runner, the Vercel build) the default client
 * is correct: it reads `DATABASE_URL` from the schema's datasource block and
 * manages its own pool for the life of the process.
 *
 * On Cloudflare Workers that client cannot run at all — it needs the query
 * engine binary — so it is built with `@prisma/adapter-pg`, which drives
 * Postgres through `pg` over the Workers socket API (`nodejs_compat`). The
 * adapter is imported statically rather than dynamically: `prisma` is a
 * module-level export, so the client has to exist synchronously, and OpenNext
 * externalises `pg` so the Worker gets the runtime's own copy rather than a
 * bundled one.
 */
function createClient(): PrismaClient {
  const log: ("error" | "warn")[] =
    process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"];

  if (isCloudflareWorkers()) {
    const connectionString = process.env.DATABASE_URL ?? "";
    const adapter = new PrismaPg({
      connectionString,
      // One connection per request keeps the shared Supabase pool from being
      // exhausted by the edge's concurrency; the pooler does the multiplexing.
      max: 1,
      // Supabase's pooler requires TLS but presents a certificate chain the
      // Workers runtime does not always carry a root for.
      ssl: connectionString.includes("supabase") ? { rejectUnauthorized: false } : undefined,
    });
    return new PrismaClient({ adapter, log });
  }

  return new PrismaClient({ log });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
