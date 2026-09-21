import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";

import {
  ACTIVE_PROJECT_REF,
  LEGACY_PROJECT_REF,
  assertWritableTarget,
  classifyDatabaseUrl,
  describeTarget,
  isLegacyDatabase,
} from "@/lib/db-target";

/**
 * The guard in front of every migration.
 *
 * The rule it enforces used to be a paragraph in `AGENTS.md`: there are two
 * Supabase accounts, the OLD one holds the only copy of the real data and is
 * read-only, and every copy runs OLD → NEW. A paragraph is not a control. A
 * migration pointed at the legacy project would *succeed* — altering the schema of
 * the read-only source of truth — and the first symptom would be a copy job that
 * could no longer load its own columns.
 *
 * The URL shapes here are the ones the project actually uses, which is the point:
 * the ref lives in the **username** of the pooler connection, not the host, so a
 * host-only check would pass every legacy pooler URL this platform contains.
 */

const LEGACY_POOLER = `postgresql://postgres.${LEGACY_PROJECT_REF}:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
const LEGACY_DIRECT = `postgresql://postgres.${LEGACY_PROJECT_REF}:pw@db.${LEGACY_PROJECT_REF}.supabase.co:5432/postgres`;
const ACTIVE_POOLER = `postgresql://postgres.${ACTIVE_PROJECT_REF}:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true`;
const ACTIVE_DIRECT = `postgresql://postgres.${ACTIVE_PROJECT_REF}:pw@db.${ACTIVE_PROJECT_REF}.supabase.co:5432/postgres`;

describe("recognising the legacy project", () => {
  it("catches both connection shapes", () => {
    // The pooler form is the one a host-only check misses.
    expect(classifyDatabaseUrl(LEGACY_POOLER).kind).toBe("legacy");
    expect(classifyDatabaseUrl(LEGACY_DIRECT).kind).toBe("legacy");
    expect(isLegacyDatabase(LEGACY_POOLER)).toBe(true);
    expect(isLegacyDatabase(LEGACY_DIRECT)).toBe(true);
  });

  it("recognises the active project as active", () => {
    for (const url of [ACTIVE_POOLER, ACTIVE_DIRECT]) {
      const verdict = classifyDatabaseUrl(url);
      expect(verdict.kind).toBe("active");
      expect(verdict.ok).toBe(true);
      expect(verdict.ref).toBe(ACTIVE_PROJECT_REF);
    }
  });

  it("is case-insensitive, because a ref is a hex-ish label", () => {
    expect(classifyDatabaseUrl(`postgresql://postgres.${LEGACY_PROJECT_REF.toUpperCase()}:pw@host/db`).kind).toBe(
      "legacy"
    );
  });

  it("does not mistake one project for the other", () => {
    // A substring check would be a real hazard here: the two refs are unrelated
    // strings, and a sloppy matcher on either could cross them.
    expect(isLegacyDatabase(ACTIVE_DIRECT)).toBe(false);
    expect(isLegacyDatabase(ACTIVE_POOLER)).toBe(false);
  });
});

describe("what is allowed", () => {
  it("allows a local or CI database", () => {
    for (const url of [
      "postgresql://postgres:postgres@localhost:5432/connectplus",
      "postgresql://user:pw@10.0.0.5:5432/test",
      "file:./dev.db",
      "",
      undefined,
      null,
    ]) {
      const verdict = classifyDatabaseUrl(url);
      expect(verdict.ok, `${String(url)} should be allowed`).toBe(true);
      expect(verdict.kind).toBe("unknown");
    }
  });

  it("treats an absent value as unknown rather than as legacy", () => {
    // Not a refusal: `prisma generate` needs no database at all.
    expect(classifyDatabaseUrl(undefined).kind).toBe("unknown");
  });
});

describe("assertWritableTarget", () => {
  it("passes a safe target", () => {
    expect(() => assertWritableTarget(ACTIVE_POOLER, "deploy migrations")).not.toThrow();
    expect(() => assertWritableTarget("postgresql://localhost/dev", "migrate")).not.toThrow();
  });

  it("throws for the legacy target and names the action in the message", () => {
    try {
      assertWritableTarget(LEGACY_DIRECT, "deploy migrations");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("deploy migrations");
      expect((error as Error).message).toContain(LEGACY_PROJECT_REF);
      expect((error as Error).message).toContain("read-only");
    }
  });
});

/**
 * The script, not the library.
 *
 * Everything above tests `db-target.ts`, and all of it passed while the guard was
 * broken — because the script that runs it is a different thing. It read
 * `process.env` without loading `.env`, so under `npm run db:guard` it saw no
 * `DATABASE_URL`, and its `if (!value) continue` then printed "Safe to deploy
 * migrations." It approved every run in which it had learned nothing.
 *
 * A guard whose whole purpose is to fail closed was failing open, and the test
 * suite could not see it because it tested the function the script calls rather
 * than the script. These spawn it.
 */
describe("the guard script itself", () => {
  const script = "scripts/assert-db-target.ts";

  /**
   * Run the guard with a controlled environment.
   *
   * Values passed here win over the real `.env`, because dotenv is loaded with
   * `override: false` — an explicitly-set variable is left alone. That is what
   * lets the absence case be tested at all: `DATABASE_URL: ""` is present and
   * empty, so dotenv stands down and the script must refuse on its own.
   */
  function run(env: Record<string, string>) {
    return spawnSync(
      "npx",
      ["ts-node", "--project", "scripts/tsconfig.script.json", script, "deploy migrations"],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 120_000,
        shell: true,
      }
    );
  }

  it(
    "refuses when DATABASE_URL is absent rather than reporting itself safe",
    () => {
      // The exact bug. An unreadable target is not a safe target.
      const result = run({ DATABASE_URL: "", DIRECT_URL: "" });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/REFUSING/);
    },
    60_000
  );

  it(
    "refuses the legacy project",
    () => {
      const legacy = `postgresql://postgres.${LEGACY_PROJECT_REF}:pw@aws-1-eu-west-1.pooler.supabase.com:6543/postgres`;
      const result = run({ DATABASE_URL: legacy, DIRECT_URL: legacy });
      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toContain(LEGACY_PROJECT_REF);
    },
    60_000
  );

  it(
    "allows a recognised local database",
    () => {
      // The guard must not become a blanket refusal: a developer's local Postgres
      // is a legitimate migration target and has neither project ref.
      const local = "postgresql://postgres:postgres@localhost:5432/connectplus";
      const result = run({ DATABASE_URL: local });
      expect(result.status).toBe(0);
    },
    60_000
  );
});

describe("describeTarget gives a logger something to say", () => {
  it("reports the active project at info", () => {
    const described = describeTarget(ACTIVE_POOLER);
    expect(described.level).toBe("info");
    expect(described.kind).toBe("active");
    expect(described.message).toContain(ACTIVE_PROJECT_REF);
  });

  it("reports anything else at info, with the ref it found", () => {
    const described = describeTarget("postgresql://user:pw@db.example.com:5432/x");
    expect(described.level).toBe("info");
    expect(described.kind).toBe("unknown");
    expect(described.ref).toBeNull();
  });

  it("reports the legacy project as an error, not a warning", () => {
    // The caller must not be able to treat this as advisory.
    const described = describeTarget(LEGACY_POOLER);
    expect(described.level).toBe("error");
    expect(described.kind).toBe("legacy");
    expect(described.ref).toBe(LEGACY_PROJECT_REF);
  });
});
