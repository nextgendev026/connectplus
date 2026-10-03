import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The route-inventory test the modernization audit asked for (F-09).
 *
 * Centralized authorization (`src/lib/policies`) is only as strong as its
 * adoption: the failure mode it exists to prevent is not a wrong check, it is
 * a *missing* one — a new admin route that answers 200 to an anonymous caller,
 * which looks exactly like a working endpoint from the outside. Seventy-two
 * self-checking routes cannot be re-read by a reviewer on every push; a static
 * scan can.
 *
 * This is deliberately a source scan, not a behaviour test: it asks "does this
 * file consult an authorization primitive at all", which is cheap, deterministic,
 * and catches the omission case. Whether the check itself *refuses* correctly is
 * covered by `tests/unit/policies.test.ts` at the policy level, one layer down.
 *
 * The marker set is the project's actual vocabulary: `auth()` with an inline
 * role check (the v0 style), the policies helpers (the v1 style), the reauth
 * step-up wrapper, and the shared-secret gates used by service callers. A route
 * that invents a ninth way to authenticate is a review conversation — but one
 * that is *in* this list means the route does decide, which is the invariant
 * this file pins.
 */

const ADMIN_ROOT = join(__dirname, "..", "..", "src", "app", "api", "admin");

/** Every file that could answer a request under /api/admin. */
function adminRouteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) adminRouteFiles(full, found);
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

/** The project's authorization vocabulary, in either style. */
const AUTH_MARKER =
  /auth\s*\(|principalFromSession|require(?:Admin|SuperAdmin|Role|User|ServiceCredential|Reauthentication)|reauthOr401|hasSharedSecret|authorize\s*\(/;

describe("route inventory", () => {
  const files = adminRouteFiles(ADMIN_ROOT);

  it("finds the admin route surface at all", () => {
    // A path that moved would silently turn the checks below into no-ops.
    expect(files.length).toBeGreaterThan(30);
  });

  it("every /api/admin route consults an authorization primitive", () => {
    const offenders = files.filter((file) => !AUTH_MARKER.test(readFileSync(file, "utf8")));
    expect(
      offenders.map((f) => f.replace(/\\/g, "/").split("/src/app/api/")[1]),
      "admin routes with no visible authorization check — a new route must call auth()/policies, not assume the perimeter"
    ).toEqual([]);
  });

  it("the mutating admin routes answer with a status a client can act on when refused", () => {
    // 401 (anonymous) or 403 (wrong role) are the two legal refusals; a route
    // that returns 200 with an empty body "instead of failing" is the shape
    // that hides an unprotected endpoint.
    const mutating = files.filter((file) =>
      /export async function (POST|PUT|PATCH|DELETE)/.test(readFileSync(file, "utf8"))
    );
    expect(mutating.length).toBeGreaterThan(20);
    const badStatus = mutating.filter((file) => {
      const src = readFileSync(file, "utf8");
      return !/status:\s*(401|403)/.test(src) && !/authenticationRequired\s*\(|forbidden\s*\(/.test(src);
    });
    expect(
      badStatus.map((f) => f.replace(/\\/g, "/").split("/src/app/api/")[1]),
      "a mutating admin route with no 401/403 refusal anywhere — it likely never refuses"
    ).toEqual([]);
  });
});
