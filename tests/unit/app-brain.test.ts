import { describe, expect, it } from "vitest";
import {
  BRAIN_SUBSYSTEMS,
  PILOT_SYSTEM_PROMPT,
  capabilitiesOf,
  runBrainSelfTest,
} from "@/lib/app-brain";
import { PILOT_OP_KINDS } from "@/lib/brain-pilot";

/**
 * The unified brain is a facade over three engines, and these tests pin the two
 * things a facade is easy to get wrong: a registry that drifts from what is
 * actually wired, and a model prompt that documents operations the client
 * cannot apply.
 */

describe("app brain — the self-test", () => {
  /**
   * This is the module's bug detector running over the code that is deployed.
   * Asserting it here means a change that quietly breaks an engine — a regex
   * swallowing whole sentences, a generator returning empty output — fails the
   * suite as well as the production console.
   */
  it("passes against the engines as they are", async () => {
    const result = runBrainSelfTest();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("app brain — the composition", () => {
  it("declares every subsystem once, with real capabilities", async () => {
    const ids = BRAIN_SUBSYSTEMS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of BRAIN_SUBSYSTEMS) {
      expect(["hive", "neural", "platform"]).toContain(s.mind);
      expect(s.name.length).toBeGreaterThan(2);
      expect(s.role.length).toBeGreaterThan(20);
      expect(s.capabilities.length).toBeGreaterThan(0);
    }
  });

  it("covers all three minds, so no engine is left out of the one brain", async () => {
    const minds = new Set(BRAIN_SUBSYSTEMS.map((s) => s.mind));
    expect(minds).toEqual(new Set(["hive", "neural", "platform"]));
  });

  it("flattens capabilities without duplicates", async () => {
    const caps = capabilitiesOf();
    expect(new Set(caps).size).toBe(caps.length);
    expect(caps).toContain("processQuery");
    expect(caps).toContain("recall");
    // Sorted, so the console renders a stable list rather than one that reshuffles.
    expect([...caps].sort()).toEqual(caps);
  });
});

describe("app brain — the pilot prompt contract", () => {
  it("documents every op the client can apply, and nothing else", async () => {
    for (const kind of PILOT_OP_KINDS) {
      expect(PILOT_SYSTEM_PROMPT).toContain(kind);
    }

    // The reverse direction is the one that breaks silently: a prompt
    // advertising an operation the vocabulary does not have means the model
    // reliably returns instructions `coercePilotOps` then throws away.
    const documented = [...PILOT_SYSTEM_PROMPT.matchAll(/\bkind":"([a-z-]+)"/g)].map((m) => m[1]);
    const listed = [...PILOT_SYSTEM_PROMPT.matchAll(/^\s{2}([a-z-]+) —/gm)].map((m) => m[1]);
    for (const kind of [...documented, ...listed]) {
      expect(PILOT_OP_KINDS as readonly string[]).toContain(kind);
    }
    expect(listed.length).toBe(PILOT_OP_KINDS.length);
  });

  it("asks for JSON, because that is the only shape the applier accepts", async () => {
    expect(PILOT_SYSTEM_PROMPT).toMatch(/ONE JSON object/);
    expect(PILOT_SYSTEM_PROMPT).toMatch(/"ops"/);
  });
});
