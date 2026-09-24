/**
 * The security core the autonomous agent runs inside.
 *
 * Four guardrails live here because they are the same idea applied to four
 * surfaces, and splitting them would let one drift from the others:
 *
 *   • **Risk tiering** — what the agent may do on its own, what it must validate
 *     first, and what a human must approve.
 *   • **Path policing** — which files it may even see or write.
 *   • **Redaction** — what may never leave the process, into an LLM prompt, a
 *     log, or a stream.
 *   • **A sandboxed runner** — how a command is executed without a shell.
 *
 * The design rule behind all four: the agent is a *user* of this module, not a
 * peer of it. Every function here assumes its input is hostile and answers with a
 * refusal rather than a best effort, because "probably fine" is not a property an
 * autonomous writer of production code gets to have.
 */

import { spawn } from "node:child_process";
import path from "node:path";

/* ── Risk tiering ─────────────────────────────────────────────────────────── */

/**
 * How much damage the operation can do if it is wrong.
 *
 * `low`    — reads and validations. Runs unattended.
 * `medium` — writes a file or a branch, but inside a revertible container, and
 *            gated behind the compiler and the linter. Runs unattended only if it
 *            validates.
 * `high`   — touches the database, auth, dependencies or a commit. Requires an
 *            approval token a Super Admin signed, every time.
 */
export type RiskTier = "low" | "medium" | "high";

export interface RiskProfile {
  tier: RiskTier;
  /** True when a Super Admin approval token is mandatory before execution. */
  requiresApproval: boolean;
  /** Plain-language statement of the blast radius, shown on the approval card. */
  blastRadius: string;
}

export const RISK: Record<RiskTier, RiskProfile> = {
  low: {
    tier: "low",
    requiresApproval: false,
    blastRadius: "Read-only. Changes nothing outside this process.",
  },
  medium: {
    tier: "medium",
    requiresApproval: false,
    blastRadius:
      "Writes files on a disposable branch and must pass lint and typecheck, or the change is reverted.",
  },
  high: {
    tier: "high",
    requiresApproval: true,
    blastRadius:
      "Can change the database schema, dependencies or repository history. Not reversible by the agent.",
  },
};

/* ── Path policing ────────────────────────────────────────────────────────── */

/** Roots the agent may read, relative to the repository root. */
const READABLE_ROOTS = ["src", "prisma", "scripts", "public", "docs"] as const;

/** Roots the agent may write to. Narrower than the readable set, on purpose. */
const WRITABLE_ROOTS = ["src/app", "src/components", "src/lib", "prisma", "scripts"] as const;

/**
 * Never readable, whatever root it sits under.
 *
 * `.env*` is the important one: an agent that can read the environment can put
 * `DATABASE_URL` in a prompt, and from then on the secret lives in a log
 * somewhere. There is no feature worth that, so the refusal is absolute.
 */
const DENIED = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.next(\/|$)/i,
  /(^|\/)\.freebuff(\/|$)/i,
  /(^|\/)dev\.db$/i,
  /(^|\/)\.vercel(\/|$)/i,
  /\.(pem|key|p12|pfx)$/i,
];

export class GuardrailError extends Error {
  constructor(
    message: string,
    readonly code:
      | "path_denied"
      | "command_not_allowed"
      | "output_too_large"
      | "timeout"
      | "not_super_admin"
      | "approval_required"
      | "approval_invalid",
  ) {
    super(message);
    this.name = "GuardrailError";
  }
}

/** Normalise to a repository-relative POSIX path, or refuse. */
export function resolveRepoPath(candidate: string, mode: "read" | "write"): string {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    throw new GuardrailError("A path is required", "path_denied");
  }
  // A NUL byte truncates the string in some syscalls; refuse rather than guess.
  if (candidate.includes("\0")) {
    throw new GuardrailError("Path contains a null byte", "path_denied");
  }

  const root = process.cwd();
  // `turbopackIgnore` is for the bundler, not the runtime: a dynamic
  // `path.resolve` here makes Turbopack trace the whole project into every
  // serverless bundle that imports this module (the build warns about it
  // explicitly, because it slows deployments). The path is resolved from
  // caller input at request time by design — containment is the job of the
  // checks below, not of the bundler. Same pattern as `resolvedPath` in
  // lib/ai/tools.ts.
  const absolute = path.resolve(/* turbopackIgnore: true */ root, candidate);
  const relative = path.relative(root, absolute);

  // Escaping the repository is always a refusal, including via `..` and via a
  // symlink baked into an absolute path the caller passed in.
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GuardrailError(`Path escapes the repository: ${candidate}`, "path_denied");
  }

  const posix = relative.split(path.sep).join("/");
  const denied = DENIED.find((re) => re.test(posix));
  if (denied) {
    throw new GuardrailError(`Path is never accessible: ${posix}`, "path_denied");
  }

  const roots = (mode === "read" ? READABLE_ROOTS : WRITABLE_ROOTS) as readonly string[];
  const allowed = roots.some((allowedRoot) => posix === allowedRoot || posix.startsWith(`${allowedRoot}/`));
  if (!allowed) {
    throw new GuardrailError(
      `Path is outside the ${mode} scope (${roots.join(", ")}): ${posix}`,
      "path_denied",
    );
  }

  return posix;
}

/* ── Redaction ────────────────────────────────────────────────────────────── */

/**
 * Secrets that must not survive into a prompt, a log or a stream.
 *
 * Deliberately broad. A false positive costs a reader a little context in a log
 * line; a false negative puts a live key in a third party's request log.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "openai-key", re: /\bsk-[A-Za-z0-9_-]{16,}/g },
  { name: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: "connection-url", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi },
  { name: "env-assignment", re: /\b([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)[A-Z0-9_]*)\s*=\s*\S+/g },
];

/** Replace every secret-looking run with a labelled placeholder. */
export function redact(value: string): string {
  let out = value;
  for (const { name, re } of SECRET_PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }
  return out;
}

/**
 * Redact anything shaped like a value, recursively.
 *
 * Objects arrive from tool arguments, which are model-authored and can nest, so
 * this walks rather than stringifies — `JSON.stringify` then replace would leave
 * key names intact and miss nothing, but it would also destroy the structure the
 * approval hash needs.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // The *name* of a secret is not itself a secret, and the names are what make
      // a redacted log readable.
      out[k] = redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}

/* ── Command allowlist ────────────────────────────────────────────────────── */

/**
 * The only commands the agent may run, as `bin subcommand` prefixes.
 *
 * An allowlist rather than a blocklist, because a blocklist has to enumerate
 * every way to destroy a machine and the allowlist only has to enumerate the six
 * things this project actually does. Anything absent is refused, and the agent is
 * told to adapt rather than retry.
 */
export const COMMAND_ALLOWLIST: readonly string[] = [
  "npm run lint",
  "npm run typecheck",
  "npm run test",
  "npm run build",
  "npm run db:generate",
  "npm run radio:check",
  "npx prisma generate",
  "npx prisma validate",
  "npx prisma format",
  "npx prisma migrate status",
  "npx prisma migrate diff",
  // `--create-only` and nothing broader. Bare `npx prisma migrate dev` applies the
  // migration to whatever `DATABASE_URL` points at, which for this project has
  // been production; it is therefore absent from the allowlist on purpose, and the
  // prefix match above cannot reach it from this entry.
  "npx prisma migrate dev --create-only",
  "npx tsc --noEmit",
  "git status",
  "git diff",
  "git log",
  "git branch",
  "git show",
  "git add",
  "git commit",
  "git checkout",
];

/**
 * Characters that mean "this is a shell, not a command".
 *
 * The runner never uses a shell, so these cannot be interpreted — but a command
 * string containing them is a sign the caller *thinks* there is one, and such a
 * command would silently run with the metacharacters as literal arguments. Better
 * to refuse loudly than to run something subtly different from the intent.
 */
const SHELL_META = /[;&|><`$()\n{}[\]*?!~#]/;

export interface CommandSpec {
  /** Executable, e.g. `npm` or `npx` — resolved by the OS, never by a shell. */
  bin: string;
  args: string[];
}

/** Parse a command string into a spec, or refuse with a reason. */
export function parseAllowedCommand(command: string): CommandSpec {
  const trimmed = command.trim().replace(/\s+/g, " ");
  if (SHELL_META.test(trimmed)) {
    throw new GuardrailError(
      `Command contains shell metacharacters and will not be run: ${redact(trimmed)}`,
      "command_not_allowed",
    );
  }
  const match = COMMAND_ALLOWLIST.filter(
    (allowed) => trimmed === allowed || trimmed.startsWith(`${allowed} `),
  ).sort((a, b) => b.length - a.length)[0];

  if (!match) {
    throw new GuardrailError(
      `Command is not on the allowlist: ${redact(trimmed)}`,
      "command_not_allowed",
    );
  }

  const [bin, ...args] = trimmed.split(" ");
  return { bin: bin!, args };
}

/* ── Sandboxed runner ─────────────────────────────────────────────────────── */

export interface RunOutcome {
  command: string;
  exitCode: number | null;
  /** Bounded, redacted stdout and stderr, interleaved in the order produced. */
  output: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

const MAX_OUTPUT_BYTES = 128 * 1024;

/**
 * Run one allowlisted command, without a shell.
 *
 * `spawn` with an argument array rather than `exec` with a concatenated string:
 * with `exec`, an argument containing `; rm -rf` is interpreted, and the allowlist
 * above would be the only thing standing between a model and the filesystem. With
 * `spawn`, that string is a literal argv entry and harmless.
 *
 * Output is capped because `npm run build` on a bad day emits megabytes, and the
 * cap must not depend on the agent choosing to read less.
 */
export async function runCommand(
  command: string,
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<RunOutcome> {
  const spec = parseAllowedCommand(command);
  const timeoutMs = Math.min(options.timeoutMs ?? 120_000, 300_000);
  const startedAt = Date.now();

  return new Promise<RunOutcome>((resolve) => {
    const child = spawn(spec.bin, spec.args, {
      cwd: options.cwd ?? process.cwd(),
      // No shell, and an environment reduced to what a build actually needs, so a
      // command cannot exfiltrate a secret by echoing it.
      shell: false,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: process.env.NODE_ENV ?? "development",
        CI: "1",
        // Prisma and Next both fail confusingly without these, and neither is a
        // capability: a build without a database URL should say so rather than
        // hang.
        DATABASE_URL: process.env.DATABASE_URL ?? "",
        DIRECT_URL: process.env.DIRECT_URL ?? "",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    });

    let output = "";
    let bytes = 0;
    let truncated = false;
    let timedOut = false;

    const collect = (chunk: Buffer) => {
      if (bytes >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }
      const text = chunk.toString("utf8");
      const remaining = MAX_OUTPUT_BYTES - bytes;
      output += text.slice(0, remaining);
      bytes += Math.min(Buffer.byteLength(text, "utf8"), remaining);
      if (bytes >= MAX_OUTPUT_BYTES) truncated = true;
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    const timer = setTimeout(() => {
      timedOut = true;
      // SIGKILL, not SIGTERM: the point of the timeout is that the process is
      // gone, and a build that ignores SIGTERM would otherwise hold the port.
      child.kill("SIGKILL");
    }, timeoutMs);

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode,
        output: redact(output),
        truncated,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        command,
        exitCode: null,
        output: redact(`Failed to start: ${error.message}`),
        truncated: false,
        timedOut,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
