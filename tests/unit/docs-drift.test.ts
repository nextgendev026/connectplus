import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { retiredSettingKeys, routableProviderIds, routableSettingKeys } from "@/lib/providers/registry";

/**
 * The documentation cannot disagree with the code.
 *
 * Every claim this file checks was, at the time it was written, *wrong* in the
 * repo:
 *
 *  • `ARCHITECTURE.md` opened by calling the app "a Next.js 15 application"
 *    while `package.json` pinned Next 16 — in the one document an agent reads
 *    before touching anything, on a Next whose own `AGENTS.md` warns that its
 *    APIs differ from what a model was trained on.
 *  • The same file advertised "OpenAI / Anthropic / OpenRouter / **Gemini**"
 *    while `ai-provider.ts` could route only OpenRouter and OpenCode Zen, and no
 *    Gemini code existed anywhere in the tree.
 *  • `README.md` claimed a scheduled-jobs table of 12 entries while the
 *    `CRON_JOBS` registry held 16, and said `npm test` runs "344 tests" when it
 *    runs 1137.
 *  • The env checklist (`.env.example`) mentioned none of the two AI provider
 *    keys the app actually reads.
 *
 * None of that broke a build, which is exactly why hand-maintained prose drifts:
 * only a test that reads both sides can hold the two together. These assertions
 * are deliberately about *relationships* (code ↔ prose) rather than about exact
 * strings, so ordinary editing does not fail the suite — only a real
 * disagreement does.
 */

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string> };
const README = read("README.md");
const ARCHITECTURE = read("ARCHITECTURE.md");
const AGENTS = read("AGENTS.md");
const DEPLOYING = read("DEPLOYING.md");
const ENV_EXAMPLE = read(".env.example");
const AI_PROVIDER_SRC = read("src/lib/ai-provider.ts");
const CRON_SRC = read("src/lib/cron-schedule.ts");
const SETTINGS_SRC = read("src/lib/settings.ts");
const INTEGRATIONS_SRC = read("src/lib/integrations.ts");

/**
 * The console keys in `SETTINGS_CATALOG`, as a set.
 *
 * `key: "name",` on its own line, at any indentation. Two tests need it and one
 * of them needs set membership, so it is computed once.
 */
const SETTINGS_CATALOG_KEYS: Set<string> = new Set(
  [...SETTINGS_SRC.matchAll(/^\s*key: "([A-Za-z0-9_]+)",$/gm)].map((m) => m[1]!)
);

/** Every document that states a version, a count or a provider list. */
const PROSE: [name: string, text: string][] = [
  ["README.md", README],
  ["ARCHITECTURE.md", ARCHITECTURE],
  ["AGENTS.md", AGENTS],
  ["DEPLOYING.md", DEPLOYING],
];

describe("documentation ↔ code drift", () => {
  it("states the same Next.js major that package.json pins", () => {
    const range = pkg.dependencies.next ?? "";
    expect(range, "package.json has no `next` dependency").toBeTruthy();
    const major = range.replace(/[^\d.]/g, "").split(".")[0];
    expect(major, `could not read a major version out of "${range}"`).toBeTruthy();

    for (const [name, text] of PROSE) {
      const stated = [...text.matchAll(/Next\.js\s+(\d+)/gi)].map((m) => m[1]!);
      if (stated.length === 0) continue; // a doc that names no version cannot contradict one
      expect(
        [...new Set(stated)],
        `${name} says Next.js ${[...new Set(stated)].join("/")} but package.json pins ${major}`
      ).toEqual([major]);
    }
  });

  it("describes exactly the AI providers the gateway can route", () => {
    // The union is the contract: names here, gateway records below, prose in the docs.
    const union = AI_PROVIDER_SRC.match(/export type AiProviderName =([^;]+);/);
    expect(union, "AiProviderName union not found in ai-provider.ts").toBeTruthy();
    const names = [...union![1]!.matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
    const gateways = names.filter((n) => n !== "builtin");
    expect(gateways.length, "no routable provider declared").toBeGreaterThan(0);

    // A declared provider with no gateway record is a provider that cannot be called.
    const implemented = [...AI_PROVIDER_SRC.matchAll(/^\s{2}([a-z]+): \{\s*$[\s\S]{0,40}?baseUrl:/gm)].map(
      (m) => m[1]!
    );
    expect(
      [...implemented].sort(),
      "AiProviderName and the OPENAI_COMPATIBLE gateway records disagree"
    ).toEqual([...gateways].sort());

    // Every routable provider is named in the two documents a developer reads.
    for (const gateway of gateways) {
      expect(README.toLowerCase(), `README.md never names the "${gateway}" provider`).toContain(gateway);
      expect(
        ARCHITECTURE.toLowerCase(),
        `ARCHITECTURE.md never names the "${gateway}" provider`
      ).toContain(gateway);
    }
  });

  it("never advertises a provider the gateway cannot route", () => {
    // Providers the app does not implement. A doc may still *mention* one — to say
    // it is unavailable — so the rule is not "must not appear" but "must not appear
    // as an offer": any sentence naming one has to say it is not in use.
    const alien = ["gemini", "groq", "mistral", "cohere", "perplexity", "xai"];
    const negation = /\b(not|never|no|cannot|can't|absent|deliberately|only)\b/i;

    for (const [name, text] of PROSE) {
      for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
        const lower = sentence.toLowerCase();
        const named = alien.filter((a) => new RegExp(`\\b${a}\\b`).test(lower));
        if (named.length === 0) continue;
        expect(
          negation.test(sentence),
          `${name} appears to offer "${named.join(", ")}" as an AI provider, but the gateway cannot ` +
            `route it. Either implement it or say it is not routed. Sentence: ${sentence.trim().slice(0, 200)}`
        ).toBe(true);
      }
    }
  });

  it("documents every registered scheduled job, and invents none", () => {
    const ids = [...CRON_SRC.matchAll(/^\s{4}id: "([a-z0-9-]+)",$/gm)].map((m) => m[1]!);
    expect(ids.length, "CRON_JOBS could not be parsed from cron-schedule.ts").toBeGreaterThan(10);

    // Scoped to the scheduled-jobs section: the README has other tables whose
    // first cell is a backticked identifier (the sports source list, for one),
    // and matching those would fail on a row that is not a job at all.
    const section = README.split(/^###\s+Scheduled jobs\s*$/m)[1]?.split(/^###\s/m)[0] ?? "";
    expect(section.length, "README.md has no '### Scheduled jobs' section").toBeGreaterThan(200);

    for (const id of ids) {
      expect(section, `the scheduled-jobs table does not list the job "${id}"`).toContain(`\`${id}\``);
    }

    // The reverse direction: a job id in the table that the registry does not
    // define would send an operator to a trigger that 404s forever.
    const documented = [...section.matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]!);
    expect(documented.length, "the scheduled-jobs table parsed as empty").toBeGreaterThan(10);
    for (const id of documented) {
      expect(ids, `the README documents the job "${id}", which is not in CRON_JOBS`).toContain(id);
    }
  });

  it("keeps the env checklist in step with the provider keys the code reads", () => {
    const envRefs = [...AI_PROVIDER_SRC.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!);
    const providerKeys = [...new Set(envRefs.filter((k) => k.endsWith("_API_KEY")))];

    for (const key of providerKeys) {
      expect(ENV_EXAMPLE, `.env.example does not mention ${key}`).toContain(key);
    }

    // And the checklist must not offer a key the gateway cannot use: an operator
    // who sets one should not be able to believe it does something.
    const assignable = [...ENV_EXAMPLE.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]!);
    expect(assignable).not.toContain("OPENAI_API_KEY");
    expect(assignable).not.toContain("ANTHROPIC_API_KEY");
  });

  it("does not hard-code counts that drift", () => {
    for (const [name, text] of PROSE) {
      expect(
        text.match(/\b\d{2,5}\s+(?:API\s+)?(?:endpoints|route handlers)\b/i)?.[0],
        `${name} hard-codes an endpoint count; it goes stale on the next route and nothing fails`
      ).toBeUndefined();

      expect(
        text.match(/\(\s*\d{2,5}\s+tests\s*\)/i)?.[0],
        `${name} hard-codes a test count; describe the suite instead of counting it`
      ).toBeUndefined();
    }
  });

  it("describes the Supabase topology exactly once", () => {
    const headings = AGENTS.match(/^##\s+Supabase topology/gm) ?? [];
    expect(
      headings,
      "AGENTS.md repeats its Supabase section — the copy-paste that made two project refs look like four"
    ).toHaveLength(1);
  });

  it("keeps the provider registry and the gateway in step", () => {
    // The registry is the fourth answer to "which providers exist" and the first
    // one that is *derived from*. The gateway's union and its gateway records are
    // the ground truth about what can actually be called; the registry must agree
    // in both directions, because a provider in one and not the other is either an
    // offer that cannot be honoured or a capability the console cannot show.
    const union = AI_PROVIDER_SRC.match(/export type AiProviderName =([^;]+);/);
    const names = [...(union?.[1] ?? "").matchAll(/"([a-z]+)"/g)].map((m) => m[1]!);
    const gateways = names.filter((n) => n !== "builtin");
    expect([...routableProviderIds()].sort()).toEqual([...gateways].sort());

    // And each registry entry must name the environment key the gateway reads.
    for (const gateway of gateways) {
      const envInSource = [...AI_PROVIDER_SRC.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]!);
      expect(
        envInSource.some((key) => key === `${gateway.toUpperCase()}_API_KEY`),
        `the gateway never reads ${gateway.toUpperCase()}_API_KEY, but the registry advertises it`
      ).toBe(true);
    }
  });

  it("offers no settings field for a credential nothing reads", () => {
    // The defect this closes: an admin could store a key for a provider the
    // gateway has no adapter for, from a console that offered the field, and then
    // see the Integrations page confirm it as provisioned.
    // Any indentation: the catalog is a flat array today, and pinning the width
    // to four spaces would fail the moment it is nested or reformatted — a test
    // failure about whitespace rather than about the property under test.
    const catalogKeys = [...SETTINGS_CATALOG_KEYS];
    // The floor is a parse guard, not a claim about size. The catalog held 53
    // entries when this was written; a parse that finds almost nothing means the
    // shape changed and the assertions below would pass vacuously.
    expect(catalogKeys.length, "SETTINGS_CATALOG could not be parsed").toBeGreaterThan(30);

    for (const key of retiredSettingKeys()) {
      // Retained keys are allowed — an existing stored value should stay visible
      // rather than become invisible dead data — but the *answer* must not change:
      // the registry says nothing reads it.
      expect(routableSettingKeys()).not.toContain(key);
    }

    // Every routable provider's console key must exist in the catalog, or the
    // console cannot configure the only providers that work.
    for (const key of routableSettingKeys()) {
      expect(catalogKeys, `the settings catalog does not offer "${key}" for a routable provider`).toContain(key);
    }
  });

  it("derives its AI provider fields from the registry rather than hardcoding them", () => {
    // The defect was a hand-built map in this file containing `openai` and
    // `anthropic`, so the Integrations console reported two providers as
    // configured whose credentials the AI pipeline never reads.
    expect(
      /providerCredentialStatus|routableProvider\(/.test(INTEGRATIONS_SRC),
      "lib/integrations.ts no longer derives its provider fields from the registry"
    );

    // And the hardcoded keys that produced the false confirmation are gone. Their
    // absence is the property: they can only come back as registry-derived fields.
    for (const key of ["openaiApiKey", "anthropicApiKey"]) {
      expect(
        INTEGRATIONS_SRC,
        `lib/integrations.ts hardcodes "${key}" again — the field must come from the provider registry`
      ).not.toContain(key);
    }

    // The old version also recognised a provider only if it appeared in a fixed
    // map, so an unrecognised name reported a degraded status without saying the
    // name was wrong. The routable list has to be consulted.
    expect(INTEGRATIONS_SRC).toContain("knownProvider");
  });

  it("resolves every managedBySetting reference to a real catalog key", () => {
    // Stale config, made detectable. `managedBySetting` is a bare string, so a
    // typo or a renamed key renders as "configured from Settings" while nothing
    // reads it. Every reference must resolve.
    const catalogKeys = SETTINGS_CATALOG_KEYS;
    const referenced = [...INTEGRATIONS_SRC.matchAll(/managedBySetting: "([A-Za-z0-9_]+)"/g)].map((m) => m[1]!);
    expect(referenced.length, "no managedBySetting references found — did the field list change shape?").toBeGreaterThan(3);

    const unresolved = [...new Set(referenced)].filter((key) => !catalogKeys.has(key));
    expect(
      unresolved,
      `these integrations claim configuration from settings keys that do not exist: ${unresolved.join(", ")}`
    ).toEqual([]);
  });

  it("names the audit as the record of known defects", () => {
    // The audit is only useful if the next reader is sent to it, and a doc that
    // references a deleted file is worse than one that references nothing.
    expect(AGENTS).toContain("docs/MODERNIZATION-AUDIT.md");
    expect(read("docs/MODERNIZATION-AUDIT.md").length).toBeGreaterThan(2000);
  });
});
