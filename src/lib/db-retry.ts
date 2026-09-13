/**
 * Retry transient database failures.
 *
 * The pooler this app talks to is small (connection_limit=5), so under a burst
 * of concurrent SSR reads Prisma can throw P2024 ("timed out fetching a new
 * connection") even though the query itself is perfectly valid. A single
 * hiccup used to surface as a *wrong* answer — e.g. the betting tips board
 * rendering "no picks yet" when the picks simply failed to load.
 *
 * Retrying once with a short jittered backoff turns that into a barely visible
 * delay instead of a lie. Real errors (bad SQL, constraint violations) are
 * rethrown immediately so they keep their stack and aren't masked.
 */

/** Prisma error codes worth retrying: pool/connection acquisition, not query bugs. */
const TRANSIENT_CODES = new Set([
  "P2024", // timed out fetching a new connection from the connection pool
  "P1001", // can't reach database server
  "P1002", // database server timed out
  "P1008", // operations timed out
  "P1017", // server has closed the connection
  "P2028", // transaction API error / expired
]);

const TRANSIENT_MESSAGES = [
  "timed out fetching a new connection",
  "connection pool",
  "server has closed the connection",
  "can't reach database server",
  "connection reset",
  "connection terminated unexpectedly",
  "ECONNRESET",
  "ETIMEDOUT",
];

/** True when a failure is infrastructure noise rather than a bad query. */
export function isTransientDbError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  const message = typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message : "";
  const lowered = message.toLowerCase();
  return TRANSIENT_MESSAGES.some((needle) => lowered.includes(needle.toLowerCase()));
}

export interface DbRetryOptions {
  /** Extra attempts after the first one. Defaults to 1. */
  retries?: number;
  /** Base backoff in ms (doubled per attempt, with jitter). Defaults to 150. */
  delayMs?: number;
  /** Injected in tests so the helper is deterministic and instant. */
  sleep?: (ms: number) => Promise<void>;
  /** Observes each retry — used for logging, never for control flow. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `operation`, retrying only transient failures. Non-transient errors and
 * the final attempt's error propagate unchanged.
 */
export async function withDbRetry<T>(operation: () => Promise<T>, options: DbRetryOptions = {}): Promise<T> {
  const retries = Math.max(0, options.retries ?? 1);
  const baseDelay = Math.max(0, options.delayMs ?? 150);
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === retries || !isTransientDbError(error)) throw error;
      const delayMs = Math.round(baseDelay * 2 ** attempt * (1 + Math.random() * 0.25));
      options.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
