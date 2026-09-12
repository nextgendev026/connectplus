/**
 * Legacy read-only Prisma client (OLD Supabase account / data-migration source).
 *
 * The NEW account is the single write head; this client exists ONLY to read
 * rows that still live in the OLD project so we can copy them across in
 * dependency order. Gated by LEGACY_DATABASE_URL - when unset the whole
 * module is inert (every helper returns empty) and the app never crashes.
 *
 * All connection values come from the environment, never from source.
 */
import { PrismaClient } from "@prisma/client";

const legacyUrl = process.env.LEGACY_DATABASE_URL;

export const legacyPrisma: PrismaClient | null = legacyUrl
  ? new PrismaClient({ datasourceUrl: legacyUrl })
  : null;

export const legacyEnabled = Boolean(legacyUrl);

/** Run a read on the legacy DB if configured; otherwise return [] / null. */
export async function legacyQuery<T>(fn: (db: PrismaClient) => Promise<T>): Promise<T | null> {
  if (!legacyPrisma) return null;
  try {
    return await fn(legacyPrisma);
  } catch (err) {
    console.error("[legacy] query failed:", err instanceof Error ? err.message : err);
    return null;
  }
}