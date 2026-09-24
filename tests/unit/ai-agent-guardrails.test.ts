import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GuardrailError, parseAllowedCommand, redact, resolveRepoPath } from "@/lib/ai/guardrails";
import {
  assertSuperAdmin,
  hashArgs,
  issueApprovalToken,
  verifyApprovalToken,
} from "@/lib/ai/approval";

/**
 * These tests exist because every one of them describes a way the agent could
 * hurt the machine it runs on. A security guardrail that is only exercised by a
 * live model is a guardrail nobody has checked.
 */

describe("path policing", () => {
  it("allows a source file inside a readable root", () => {
    expect(resolveRepoPath("src/lib/ai/tools.ts", "read")).toBe("src/lib/ai/tools.ts");
  });

  it("allows writing where the agent is scoped to write", () => {
    expect(resolveRepoPath("src/lib/ai/guardrails.ts", "write")).toBe("src/lib/ai/guardrails.ts");
  });

  it("refuses to write outside the writable scope", () => {
    // `docs/` is readable but not writable: reading documentation is useful,
    // rewriting it unattended is not.
    expect(() => resolveRepoPath("docs/agent.md", "write")).toThrow(GuardrailError);
  });

  it("refuses an environment file even though it lives in a readable root", () => {
    expect(() => resolveRepoPath(".env", "read")).toThrow(/never accessible/);
    expect(() => resolveRepoPath(".env.local", "read")).toThrow(/never accessible/);
  });

  it("refuses the repository internals and the local database", () => {
    for (const path of [".git/config", "node_modules/react/index.js", "prisma/dev.db"]) {
      expect(() => resolveRepoPath(path, "read")).toThrow(GuardrailError);
    }
  });

  it("refuses to escape the repository", () => {
    expect(() => resolveRepoPath("../../etc/passwd", "read")).toThrow(/escapes the repository/);
  });

  it("refuses a null byte rather than truncating at it", () => {
    expect(() => resolveRepoPath("src/lib/ai/ok.ts\0.env", "read")).toThrow(/null byte/);
  });
});

describe("command allowlist", () => {
  it("accepts an allowlisted command", () => {
    expect(parseAllowedCommand("npm run typecheck")).toEqual({ bin: "npm", args: ["run", "typecheck"] });
  });

  it("accepts an allowlisted command with arguments", () => {
    expect(parseAllowedCommand("npx prisma migrate dev --create-only --name agent")).toEqual({
      bin: "npx",
      args: ["prisma", "migrate", "dev", "--create-only", "--name", "agent"],
    });
  });

  it("refuses a command that is not on the allowlist", () => {
    expect(() => parseAllowedCommand("rm -rf /")).toThrow(/not on the allowlist/);
    expect(() => parseAllowedCommand("curl http://example.com")).toThrow(/not on the allowlist/);
  });

  it("refuses shell metacharacters instead of passing them as arguments", () => {
    // The runner never uses a shell, so these could not be interpreted — but a
    // caller writing them believes there is one, and running something subtly
    // different from the intent is worse than refusing.
    for (const command of [
      "npm run typecheck; rm -rf /",
      "npm run typecheck && curl evil.sh",
      "npm run typecheck | tee /tmp/x",
      "npm run typecheck $(whoami)",
      "npm run typecheck > /tmp/out",
    ]) {
      expect(() => parseAllowedCommand(command)).toThrow(GuardrailError);
    }
  });

  it("refuses to build a command from a prefix it merely starts with", () => {
    // `npm run lint-everything` shares a prefix with `npm run lint` and must not
    // inherit its permission.
    expect(() => parseAllowedCommand("npm run linter")).toThrow(/not on the allowlist/);
  });
});

describe("redaction", () => {
  it("removes credentials that would otherwise reach a model or a log", () => {
    const text = [
      "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz",
      "Authorization: Bearer abcdefghijklmnopqrstu",
      "DATABASE_URL=postgresql://user:hunter2@db.example.com:5432/prod",
      "ghp_abcdefghijklmnopqrstuvwxyz012345",
    ].join("\n");

    const out = redact(text);
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz012345");
    expect(out).toContain("[REDACTED:");
  });

  it("leaves ordinary prose alone", () => {
    expect(redact("The radio dial has 34 stations.")).toBe("The radio dial has 34 stations.");
  });
});

describe("approval tokens", () => {
  const original = process.env.AUTH_SECRET;

  beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-to-sign-with";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
  });

  const call = {
    actorId: "admin-1",
    tool: "managePrismaMigrations",
    args: { action: "create-only", name: "agent_upgrade" },
  };

  it("accepts a token it issued for the same actor, tool and arguments", () => {
    const grant = issueApprovalToken(call, "Generate a migration");
    expect(verifyApprovalToken(grant.token, call)).toEqual({ ok: true });
  });

  it("refuses a token issued to a different admin", () => {
    const grant = issueApprovalToken(call, "Generate a migration");
    const result = verifyApprovalToken(grant.token, { ...call, actorId: "admin-2" });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/different admin/);
  });

  it("refuses a token when the arguments changed after approval", () => {
    // The heart of the design: an approval for one migration cannot be replayed
    // for another.
    const grant = issueApprovalToken(call, "Generate a migration");
    const result = verifyApprovalToken(grant.token, {
      ...call,
      args: { action: "create-only", name: "drop_everything" },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/arguments changed/);
  });

  it("refuses a token issued for a different tool", () => {
    const grant = issueApprovalToken(call, "Generate a migration");
    const result = verifyApprovalToken(grant.token, { ...call, tool: "writeCodePatchWithStaging" });
    expect(result.ok).toBe(false);
  });

  it("refuses an expired token", () => {
    const grant = issueApprovalToken({ ...call, ttlSeconds: -1 }, "Generate a migration");
    const result = verifyApprovalToken(grant.token, call);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/expired/);
  });

  it("refuses a token whose payload was edited", () => {
    const grant = issueApprovalToken(call, "Generate a migration");
    const [payload, signature] = grant.token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ a: "admin-1", t: "managePrismaMigrations", h: hashArgs(call.args), e: Date.now() + 600000 }),
      "utf8",
    ).toString("base64url");
    const result = verifyApprovalToken(`${forged}.${signature}`, call);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/signature/);
    // Sanity: the payload really did change, so the refusal is about the signature.
    expect(forged).not.toBe(payload);
  });

  it("refuses to issue or verify at all without a signing secret", () => {
    // Fail closed. No secret means no autonomous high-risk action, never an
    // unauthenticated one.
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    expect(() => issueApprovalToken(call, "Generate a migration")).toThrow(/AUTH_SECRET/);
    expect(verifyApprovalToken("payload.signature", call).ok).toBe(false);
  });

  it("hashes arguments independently of key order", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
    expect(hashArgs({ a: 1, b: 2 })).not.toBe(hashArgs({ a: 2, b: 1 }));
  });
});

describe("super admin assertion", () => {
  it("accepts a super admin", () => {
    expect(assertSuperAdmin({ actorId: "u1", role: "SUPER_ADMIN" }).actorId).toBe("u1");
  });

  it("refuses an ordinary admin, a user, and an anonymous caller", () => {
    expect(() => assertSuperAdmin({ actorId: "u1", role: "ADMIN" })).toThrow(/Super Admin/);
    expect(() => assertSuperAdmin({ actorId: "u1", role: "USER" })).toThrow(/Super Admin/);
    expect(() => assertSuperAdmin({ actorId: "", role: "SUPER_ADMIN" })).toThrow(/Authentication/);
    expect(() => assertSuperAdmin(null)).toThrow(/Authentication/);
  });
});
