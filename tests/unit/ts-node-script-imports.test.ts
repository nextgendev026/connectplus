import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The `ts-node` scripts run *outside* Next's bundler.
 *
 * `scripts/tsconfig.script.json` sets `module: commonjs` and points ts-node at
 * bare `scripts/ensure-settings.ts`. There is no `tsconfig-paths/register` in
 * that invocation, so the `@/*` path alias — which Next resolves for the app —
 * does not exist at runtime. A value import of `@/...` therefore throws
 * `MODULE_NOT_FOUND` at `require()` time.
 *
 * This is not a hypothetical. `vercel-build` runs
 * `db:guard && prisma migrate deploy && prisma generate && db:ensure && next build`,
 * and `db:ensure` deliberately exits 1 when it fails. Adding
 * `import { guardCacheWrite } from "@/lib/cache-policy"` to `src/lib/redis.ts`
 * (reachable as `ensure-settings → settings → redis → cache-policy`) broke
 * `db:ensure`, so **every** deploy from that commit onward failed before
 * `next build` ever started — while `npm run build` locally stayed green,
 * because only `vercel-build` runs `db:ensure`.
 *
 * So the failure mode this test exists to prevent is a green local build and a
 * red deploy, discovered one alias at a time. The walk is static on purpose:
 * it costs nothing, needs no database, and reports *every* offender at once
 * rather than the first one the runtime happens to reach.
 *
 * Type-only aliases are fine and are deliberately allowed — `import type` (and
 * an all-`type` named clause) is erased before the require happens.
 */

const ROOT = path.resolve(__dirname, "../..");

/** Matches `import`/`export ... from "spec"`, including multi-line clauses. */
const FROM_RE = /(?:^|\n)[ \t]*(import|export)[ \t]+([^;]*?)[ \t]*from[ \t]*["']([^"']+)["']/g;
const REQUIRE_RE = /require\(\s*["']([^"']+)["']\s*\)/g;
const DYNAMIC_RE = /(?:^|[^.\w])import\(\s*["']([^"']+)["']\s*\)/g;

/**
 * A clause is type-only when it is `type X`, `type { X }`, or a brace list in
 * which every specifier is individually prefixed with `type`.
 */
function isTypeOnlyClause(clause: string): boolean {
  const c = clause.trim();
  if (/^type\s/.test(c)) return true;
  const braced = /^\{([\s\S]*)\}$/.exec(c);
  if (!braced) return false;
  const parts = (braced[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((p) => /^type\s/.test(p));
}

/** Commentary is not code: strip it so a prose mention of an alias can't fail the test. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

type Finding = { file: string; line: number; spec: string };

/**
 * Specifiers a module will resolve at runtime. `null` means "not resolvable by
 * this walker" (a package, a bare specifier, or an alias).
 */
function runtimeSpecifiers(file: string): Finding[] {
  const source = stripComments(fs.readFileSync(file, "utf8"));
  const found: Finding[] = [];
  const lineOf = (index: number) => source.slice(0, index).split("\n").length;

  FROM_RE.lastIndex = 0;
  for (let m = FROM_RE.exec(source); m; m = FROM_RE.exec(source)) {
    const clause = m[2] ?? "";
    if (isTypeOnlyClause(clause)) continue;
    found.push({ file, line: lineOf(m.index), spec: m[3] ?? "" });
  }

  for (const re of [REQUIRE_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    for (let m = re.exec(source); m; m = re.exec(source)) {
      found.push({ file, line: lineOf(m.index), spec: m[1] ?? "" });
    }
  }

  return found;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  // `allowImportingTsExtensions` is on, so explicit `.ts` specifiers appear too.
  return fs.existsSync(base) && fs.statSync(base).isFile() ? base : null;
}

/** Entry points derived from package.json, so a new ts-node script is covered automatically. */
function tsNodeEntries(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
    scripts?: Record<string, string>;
  };
  const entries = new Set<string>();
  for (const command of Object.values(pkg.scripts ?? {})) {
    if (!command.includes("ts-node")) continue;
    for (const token of command.split(/\s+/)) {
      if (!token.endsWith(".ts")) continue;
      const entry = path.resolve(ROOT, token);
      if (fs.existsSync(entry)) entries.add(entry);
    }
  }
  return [...entries].sort();
}

describe("ts-node scripts must not import the '@/' alias at runtime", () => {
  const entries = tsNodeEntries();

  it("finds the ts-node entry points", () => {
    // If this ever drops to zero the walk would pass vacuously.
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) expect(fs.existsSync(entry)).toBe(true);
  });

  it("has no runtime '@/' imports anywhere in the reachable graph", () => {
    const violations: Finding[] = [];
    const visited = new Set<string>();
    const queue = [...entries];

    while (queue.length > 0) {
      const file = queue.shift();
      if (!file || visited.has(file)) continue;
      visited.add(file);

      for (const finding of runtimeSpecifiers(file)) {
        if (finding.spec.startsWith("@/")) {
          violations.push(finding);
          continue;
        }
        if (!finding.spec.startsWith(".")) continue; // bare package specifier
        const resolved = resolveRelative(file, finding.spec);
        // An unresolvable relative specifier is a different bug; ignore it here.
        if (resolved) queue.push(resolved);
      }
    }

    // Guard against the walk silently collapsing to a couple of files.
    expect(visited.size).toBeGreaterThan(5);

    const report = violations
      .map((v) => `  ${path.relative(ROOT, v.file).replace(/\\/g, "/")}:${v.line}  ${v.spec}`)
      .join("\n");

    expect(
      violations,
      violations.length === 0
        ? ""
        : `These run through ts-node, which has no '@/' alias resolver, so they will\n` +
            `throw MODULE_NOT_FOUND and fail \`vercel-build\` before next build:\n${report}\n\n` +
            `Use a relative specifier, or a type-only import if it is genuinely types.`,
    ).toEqual([]);
  });
});
