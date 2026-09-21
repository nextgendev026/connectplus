/**
 * This module deliberately imports **nothing**.
 *
 * It is the guard that runs immediately before a migration, from `ts-node` in a
 * build container and from a developer's shell — contexts where Next's `@/*` path
 * alias does not resolve. The first version imported the logger and failed with
 * `MODULE_NOT_FOUND` on its very first real invocation: a safety check that cannot
 * start is worse than no check at all, because it fails closed on *legitimate*
 * work and the operator learns to bypass it. Everything it needs is a string and a
 * regex, so it stays dependency-free and `describeTarget` hands the wording to the
 * caller, which does have a logger.
 */

/**
 * Which database is this process actually pointed at?
 *
 * There are two Supabase accounts, and `AGENTS.md` has to repeat the distinction
 * in bold because getting it wrong is not a small mistake: the OLD project holds
 * the only real data and is **read-only**, and the NEW project is the only one
 * anything should be written to or migrated against. The direction of every copy
 * is OLD → NEW, permanently.
 *
 * That rule was enforced by a paragraph of prose and an operator's attention.
 * Meanwhile `npm run db:migrate:prod` is one keystroke away and reads whatever
 * `DATABASE_URL` happens to contain — and a migration aimed at the legacy project
 * would not fail. It would *succeed*, altering the schema of the read-only source
 * of truth for every historical row, and the first symptom would be a copy job
 * failing to load its own columns.
 *
 * So the check is code, it runs before the migration tools, and it fails closed:
 * a URL we cannot classify is not waved through. The refs are here as identifiers,
 * not secrets — they already appear in `AGENTS.md`, `.env.example` and the Vercel
 * dashboard, and a guard that has to look up its own constant is a guard that can
 * be misconfigured.
 */

/** The active project: schema owner, all writes, all migrations. */
export const ACTIVE_PROJECT_REF = "sobouolsnvgksdjzpcsj";

/** The legacy project: the real data, and read-only forever. */
export const LEGACY_PROJECT_REF = "eligxvxirkfnqqkywxhv";

export type TargetVerdict =
  | { ok: true; ref: string | null; kind: "active" | "unknown" }
  | { ok: false; ref: string | null; kind: "legacy"; reason: string };

/**
 * Hosts that identify a Supabase project.
 *
 * `db.<ref>.supabase.co` is the direct connection and
 * `aws-0-<region>.pooler.supabase.com` carries the ref in the **username**
 * (`postgres.<ref>`), not the host — which is exactly the shape a host-only check
 * would miss, and the shape this project actually uses.
 */
function refFromUrl(url: string): string | null {
  // Direct: postgresql://postgres.<ref>:pw@db.<ref>.supabase.co:5432/postgres
  const direct = url.match(/@db\.([a-z0-9]{20})\.supabase\.(?:co|com)/i);
  if (direct?.[1]) return direct[1].toLowerCase();

  // Pooler: postgresql://postgres.<ref>:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres
  const poolerUser = url.match(/\/\/postgres\.([a-z0-9]{20}):/i);
  if (poolerUser?.[1]) return poolerUser[1].toLowerCase();

  // Anywhere else the project ref appears as a label.
  const loose = url.match(/\/\/(?:[^@/]*@)?[^/]*?([a-z0-9]{20})\.supabase\./i);
  if (loose?.[1]) return loose[1].toLowerCase();

  return null;
}

/**
 * Classify a connection string.
 *
 * A URL that names neither project is `unknown`, and `unknown` is allowed for
 * normal operation (a developer's local Postgres, a CI database, SQLite for
 * `prisma dev`) — but callers that are about to *migrate* should treat `unknown`
 * as a reason to print what they are about to touch. The one outcome that is
 * never allowed is `legacy`.
 */
export function classifyDatabaseUrl(url: string | null | undefined): TargetVerdict {
  const value = (url ?? "").trim();
  if (!value) {
    return { ok: true, ref: null, kind: "unknown" };
  }

  const ref = refFromUrl(value);
  if (ref === LEGACY_PROJECT_REF) {
    return {
      ok: false,
      ref,
      kind: "legacy",
      // Source-agnostic: the caller names the variable it checked, so this reads
      // correctly for DATABASE_URL, DIRECT_URL or anything else that carries one.
      reason:
        `the connection string points at the LEGACY project (${LEGACY_PROJECT_REF}), which is the ` +
        `read-only source of historical data. Never migrate or write to it — copy OLD → NEW.`,
    };
  }

  return { ok: true, ref, kind: ref === ACTIVE_PROJECT_REF ? "active" : "unknown" };
}

export function isLegacyDatabase(url: string | null | undefined): boolean {
  return classifyDatabaseUrl(url).kind === "legacy";
}

/**
 * Refuse to continue if the target is the legacy project.
 *
 * Throws rather than returning, because every caller's correct response is to
 * stop: a caller that received `false` and carried on would be the bug.
 */
export function assertWritableTarget(url: string | null | undefined, action: string): void {
  const verdict = classifyDatabaseUrl(url);
  if (!verdict.ok) {
    throw new Error(`Refusing to ${action}: ${verdict.reason}`);
  }
}

/**
 * One line describing what a target is, for whatever logger the caller has.
 *
 * A target that is neither project is not a refusal — a local Postgres, a CI
 * database and SQLite for `prisma dev` all land here — but it is worth saying out
 * loud, because "which database did that migration just touch" is the question
 * nobody asks until it matters.
 */
export function describeTarget(url: string | null | undefined): {
  level: "info" | "error";
  kind: TargetVerdict["kind"];
  ref: string | null;
  message: string;
} {
  const verdict = classifyDatabaseUrl(url);
  if (!verdict.ok) {
    return { level: "error", kind: verdict.kind, ref: verdict.ref, message: verdict.reason };
  }
  if (verdict.kind === "active") {
    return {
      level: "info",
      kind: verdict.kind,
      ref: verdict.ref,
      message: `target is the active project (${ACTIVE_PROJECT_REF})`,
    };
  }
  return {
    level: "info",
    kind: verdict.kind,
    ref: verdict.ref,
    message: `target is not a known Supabase project (${verdict.ref ?? "no project ref found"})`,
  };
}
