import { describe, expect, it } from "vitest";

import {
  ADMIN_ROLES,
  ANONYMOUS,
  ROLES,
  SCOPES,
  type Principal,
  type Role,
  hasScope,
  isRole,
  principalFromSession,
  requireAdmin,
  requireOwnership,
  requireOwnershipOrRole,
  requireRole,
  requireScope,
  requireSuperAdmin,
  requireUser,
  requireVerifiedUser,
  scopesForRole,
} from "@/lib/policies";
import { AppError, codeFor } from "@/lib/errors";

/**
 * Authorization, asserted as behaviour rather than as a table.
 *
 * The tests that matter here are the *refusals*. A permission system is only as
 * good as its denials, and a denial is invisible in production: an endpoint that
 * lets the wrong person in looks identical to one that works. So every predicate
 * is tested from the outside in — anonymous, wrong role, right role, and the edge
 * cases that are easy to get wrong (a null owner, an unknown role, a missing
 * session).
 */

function principal(overrides: Partial<Principal> = {}): Principal {
  return { actorId: "user-1", role: "USER", emailVerified: true, ...overrides };
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (error) {
    return codeFor(error);
  }
}

describe("the scope table is total and closed", () => {
  it("grants only declared scopes to any role", () => {
    for (const role of ROLES) {
      for (const scope of scopesForRole(role)) {
        expect(SCOPES, `${role} was granted undeclared scope ${scope}`).toContain(scope);
      }
    }
  });

  it("denies an unknown or missing role rather than falling back to a user", () => {
    // The direction matters: a role string that this table has not heard of is a
    // bug or a half-finished migration, and neither should mean "a normal user".
    expect(scopesForRole(null)).toEqual([]);
    expect(scopesForRole(undefined)).toEqual([]);
    expect(scopesForRole("MODERATOR" as Role)).toEqual([]);
    expect(scopesForRole("" as Role)).toEqual([]);
  });

  it("escalates: an admin has strictly more than a user, a superadmin more than an admin", () => {
    const user = new Set(scopesForRole("USER"));
    const admin = new Set(scopesForRole("ADMIN"));
    const superAdmin = new Set(scopesForRole("SUPER_ADMIN"));

    for (const scope of user) expect(admin.has(scope), `ADMIN lost ${scope}`).toBe(true);
    for (const scope of admin) expect(superAdmin.has(scope), `SUPER_ADMIN lost ${scope}`).toBe(true);
    expect(admin.size).toBeGreaterThan(user.size);
    expect(superAdmin.size).toBeGreaterThan(admin.size);
  });

  it("keeps the dangerous capabilities out of the ordinary admin role", () => {
    // An ADMIN is a trusted operator, not a second owner: approving the brain's
    // own proposals, changing money, and deploying are deliberately above them.
    for (const scope of ["ai:approve", "payments:write", "deploy:production", "deploy:staging"] as const) {
      expect(hasScope(principal({ role: "ADMIN" }), scope), `ADMIN should not hold ${scope}`).toBe(false);
      expect(hasScope(principal({ role: "SUPER_ADMIN" }), scope), `SUPER_ADMIN should hold ${scope}`).toBe(true);
    }
  });

  it("recognises exactly the declared role strings", () => {
    for (const role of ROLES) expect(isRole(role)).toBe(true);
    for (const notRole of ["admin", "SuperAdmin", "ROOT", "", null, 42, {}]) {
      expect(isRole(notRole), `${String(notRole)} should not be a role`).toBe(false);
    }
  });
});

describe("identity is read from the session, not the caller", () => {
  it("treats a session with no user id as anonymous", () => {
    expect(principalFromSession(null)).toEqual(ANONYMOUS);
    expect(principalFromSession({})).toEqual(ANONYMOUS);
    expect(principalFromSession({ user: null })).toEqual(ANONYMOUS);
    expect(principalFromSession({ user: { id: "" } })).toEqual(ANONYMOUS);
  });

  it("refuses a role the table does not know, rather than trusting the string", () => {
    const p = principalFromSession({ user: { id: "u1", role: "OWNER" } });
    expect(p.actorId).toBe("u1");
    expect(p.role).toBeNull();
    // And an unknown role therefore holds nothing at all.
    expect(scopesForRole(p.role)).toEqual([]);
  });

  it("carries email verification through", () => {
    const verified = principalFromSession({
      user: { id: "u1", role: "USER", emailVerified: new Date() },
    });
    const unverified = principalFromSession({ user: { id: "u1", role: "USER", emailVerified: null } });
    expect(verified.emailVerified).toBe(true);
    expect(unverified.emailVerified).toBe(false);
  });
});

describe("the predicates refuse what they should", () => {
  it("requires a session before anything else", () => {
    expect(codeOf(() => requireUser(ANONYMOUS))).toBe("AUTHENTICATION_REQUIRED");
    expect(codeOf(() => requireAdmin(ANONYMOUS))).toBe("AUTHENTICATION_REQUIRED");
    expect(codeOf(() => requireScope(ANONYMOUS, "posts:read"))).toBe("AUTHENTICATION_REQUIRED");
  });

  it("distinguishes forbidden from unauthenticated", () => {
    // 403 for a signed-in caller who lacks the right: telling them "sign in" when
    // they already are is a loop the client cannot escape.
    expect(codeOf(() => requireAdmin(principal({ role: "USER" })))).toBe("FORBIDDEN");
    expect(codeOf(() => requireSuperAdmin(principal({ role: "ADMIN" })))).toBe("FORBIDDEN");
    expect(codeOf(() => requireScope(principal({ role: "USER" }), "ai:approve"))).toBe("FORBIDDEN");
  });

  it("lets a role with a null role value hold nothing", () => {
    const broken = principal({ role: null });
    expect(codeOf(() => requireScope(broken, "posts:read"))).toBe("FORBIDDEN");
    expect(codeOf(() => requireAdmin(broken))).toBe("FORBIDDEN");
  });

  it("demands a verified account only where it asks for one", () => {
    const unverified = principal({ emailVerified: false });
    expect(codeOf(() => requireUser(unverified))).toBe("NO_THROW");
    expect(codeOf(() => requireVerifiedUser(unverified))).toBe("FORBIDDEN");
    expect(codeOf(() => requireVerifiedUser(principal()))).toBe("NO_THROW");
  });

  it("accepts the roles it names and rejects the others", () => {
    expect(requireRole(principal({ role: "ADMIN" }), ADMIN_ROLES).role).toBe("ADMIN");
    expect(codeOf(() => requireRole(principal({ role: "USER" }), ADMIN_ROLES))).toBe("FORBIDDEN");
  });
});

describe("ownership is a separate question from role", () => {
  it("refuses someone else's row", () => {
    expect(codeOf(() => requireOwnership(principal(), "user-2"))).toBe("FORBIDDEN");
  });

  it("refuses a row with no owner instead of treating it as public", () => {
    // The bug this pins: `ownerId !== actorId` is false for null only if you write
    // the check backwards, and "unowned" then reads as "everyone's".
    expect(codeOf(() => requireOwnership(principal(), null))).toBe("FORBIDDEN");
    expect(codeOf(() => requireOwnership(principal(), undefined))).toBe("FORBIDDEN");
    expect(codeOf(() => requireOwnership(principal(), ""))).toBe("FORBIDDEN");
  });

  it("lets the owner through", () => {
    expect(requireOwnership(principal(), "user-1").actorId).toBe("user-1");
  });

  it("lets a moderator override, and nobody else", () => {
    expect(requireOwnershipOrRole(principal({ role: "ADMIN" }), "user-9").actorId).toBe("user-1");
    expect(requireOwnershipOrRole(principal({ role: "SUPER_ADMIN" }), "user-9").actorId).toBe("user-1");
    expect(codeOf(() => requireOwnershipOrRole(principal({ role: "USER" }), "user-9"))).toBe("FORBIDDEN");
    // An override is only reachable by a role, never by the row being unowned.
    expect(codeOf(() => requireOwnershipOrRole(principal({ role: "USER" }), null))).toBe("FORBIDDEN");
  });
});

describe("a refused scope never becomes a crash", () => {
  it("throws an AppError the API layer knows how to shape", () => {
    try {
      requireScope(principal({ role: "USER" }), "deploy:production");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(403);
      expect((error as AppError).disclosable).toBe(true);
    }
  });
});
