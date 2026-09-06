type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configuredLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function enabled(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[configuredLevel];
}

function write(level: LogLevel, scope: string, message: string, meta?: unknown): void {
  if (!enabled(level)) return;
  const line = meta === undefined
    ? `[${level.toUpperCase()}] [${scope}] ${message}`
    : `[${level.toUpperCase()}] [${scope}] ${message} ${safeJson(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, meta?: unknown) => write("debug", scope, message, meta),
    info: (message: string, meta?: unknown) => write("info", scope, message, meta),
    warn: (message: string, meta?: unknown) => write("warn", scope, message, meta),
    error: (message: string, meta?: unknown) => write("error", scope, message, meta),
    child: (childScope: string) => createLogger(`${scope}:${childScope}`),
  };
}