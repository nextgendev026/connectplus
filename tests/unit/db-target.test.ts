import { describe, expect, it } from "vitest";

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
