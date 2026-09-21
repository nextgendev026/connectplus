import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The operations half of the approval allowlist.
 *
 * Two things are worth pinning here. First, that a platform operation is a
 * *request* like any other — it is filed, summarised from its arguments, and run
 * only by an admin's click. Second, that the tools a request can reach are the
 * ones the operations mind declared, and that the studio copilot can reach none
 * of them.
 */
const proposalFindFirst = vi.fn();
const proposalCreate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainActionProposal: {
      findFirst: (...a: unknown[]) => proposalFindFirst(...a),
      create: (...a: unknown[]) => proposalCreate(...a),
    },
  },
}));

vi.mock("@/lib/mind-actions", () => ({ mindActions: {} }));

const sweepInternal = vi.fn();
vi.mock("@/lib/hive-brain", () => ({
  hiveBrain: { sweepInternal: (...a: unknown[]) => sweepInternal(...a) },
}));

const updateSettings = vi.fn();
vi.mock("@/lib/settings", () => ({
  updateSettings: (...a: unknown[]) => updateSettings(...a),
  getSettings: vi.fn(),
}));

const { APPROVAL_TOOLS, proposeAction } = await import("@/lib/brain-approvals");
const { OPERATIONS_TOOLS, EDITORIAL_TOOLS } = await import("@/lib/admin-intelligence");

beforeEach(() => {
  vi.clearAllMocks();
  proposalFindFirst.mockResolvedValue(null);
  proposalCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: "prop-1",
    createdAt: new Date(),
    decidedNote: null,
    reviewedBy: null,
    reviewedAt: null,
    result: null,
    ...data,
  }));
});

describe("the operations allowlist", () => {
  it("registers each operations tool with a label, a risk and a description", () => {
    for (const tool of OPERATIONS_TOOLS) {
      const spec = APPROVAL_TOOLS[tool];
      expect(spec, `${tool} is missing from the allowlist`).toBeDefined();
      expect(spec.label.length).toBeGreaterThan(3);
      expect(["low", "medium", "high"]).toContain(spec.risk);
      expect(typeof spec.run).toBe("function");
    }
  });

  it("requires no arguments for the tools that take none", () => {
    const argumentFree = OPERATIONS_TOOLS.filter((t) => t !== "set_repair_mode");
    for (const tool of argumentFree) {
      expect(APPROVAL_TOOLS[tool].required, tool).toEqual([]);
    }
    expect(APPROVAL_TOOLS.set_repair_mode.required).toEqual(["mode"]);
  });

  it("describes a self-heal change from the argument, including what it would enable", () => {
    const enforce = APPROVAL_TOOLS.set_repair_mode.describe({ mode: "enforce" });
    const observe = APPROVAL_TOOLS.set_repair_mode.describe({ mode: "observe" });
    expect(enforce).toContain("enforce");
    expect(enforce).toContain("unattended");
    expect(observe).toContain("change nothing");
    expect(enforce).not.toBe(observe);
  });
});

describe("filing an operation", () => {
  it("files it for approval rather than running it", async () => {
    const result = await proposeAction({
      tool: "run_hive_sweep",
      args: {},
      rationale: "The console asked for a sweep.",
      requestedBy: "admin-1",
      source: "admin-console",
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Nothing has changed yet");
    expect(sweepInternal).not.toHaveBeenCalled();
  });

  it("refuses a self-heal change that names no mode", async () => {
    const result = await proposeAction({
      tool: "set_repair_mode",
      args: {},
      rationale: "Turn it up.",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("missing_arguments");
    expect(result.message).toContain("mode");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("still refuses a tool that is not on the allowlist", async () => {
    const result = await proposeAction({ tool: "restart_the_server", args: {}, rationale: "just do it" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unknown_tool");
  });
});

describe("running an approved operation", () => {
  it("reports the sweep's real counts, not a claim", async () => {
    sweepInternal.mockResolvedValue({
      postsScanned: 12,
      commentsScanned: 30,
      postsLearned: 4,
      commentsLearned: 2,
      memoriesCreated: 6,
      totalMemories: 500,
    });

    const outcome = await APPROVAL_TOOLS.run_hive_sweep.run({}, "admin-1");
    expect(outcome.ok).toBe(true);
    expect(outcome.summary).toContain("12 stories");
    expect(outcome.summary).toContain("6 new lessons");
    expect(outcome.summary).toContain("500 in memory now");
  });

  it("refuses an invalid self-heal mode without writing anything", async () => {
    const outcome = await APPROVAL_TOOLS.set_repair_mode.run({ mode: "yolo" }, "admin-1");
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("invalid_mode");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("writes the envelope when the mode is valid", async () => {
    updateSettings.mockResolvedValue(undefined);
    const outcome = await APPROVAL_TOOLS.set_repair_mode.run({ mode: "enforce" }, "admin-1");
    expect(outcome.ok).toBe(true);
    expect(updateSettings).toHaveBeenCalledWith({ brainSelfHeal: "enforce" });
  });
});

/* ── The boundary, asserted against the source ───────────────────────────── */

/**
 * These read the module's own imports and vocabulary.
 *
 * A boundary held only by convention is one refactor away from being gone, and
 * the failure mode is quiet: a copilot that can file platform changes looks
 * exactly like one that cannot until someone types the right sentence. Reading
 * the file makes widening its reach a test failure instead.
 */
describe("the copilot boundary", () => {
  const studio = readFileSync(path.join(process.cwd(), "src/lib/neural-studio.ts"), "utf8");
  const imports = [...studio.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);

  it("imports no approvals, operations or action-executing module", () => {
    const forbidden = ["brain-approvals", "admin-intelligence", "mind-actions", "brain-repair"];
    for (const banned of forbidden) {
      expect(imports.some((i) => i.endsWith(banned)), `neural-studio imports ${banned}`).toBe(false);
    }
  });

  it("touches the pilot vocabulary only as a type", () => {
    // `brain-pilot` is the composer's own edit-op shape and belongs to the
    // copilot. A *type* import is the guarantee that matters: the copilot names
    // the shape of an edit and can never hold a function that performs one.
    const statements = studio.match(/^import\b[\s\S]*?;$/gm) ?? [];
    const pilotImports = statements.filter((s) => /from "@\/lib\/brain-pilot"/.test(s));
    expect(pilotImports.length).toBeGreaterThan(0);
    for (const statement of pilotImports) {
      expect(statement.trimStart().startsWith("import type"), statement).toBe(true);
    }
  });

  it("names no platform operation anywhere in its vocabulary", () => {
    const actions = [...studio.matchAll(/case "([a-z]+)":/g)].map((m) => m[1]!);
    expect(actions.length).toBeGreaterThan(5);
    for (const tool of [...OPERATIONS_TOOLS, ...EDITORIAL_TOOLS]) {
      expect(actions, `the copilot has a case for ${tool}`).not.toContain(tool);
      expect(studio.includes(`"${tool}"`), `neural-studio mentions ${tool}`).toBe(false);
    }
  });
});
