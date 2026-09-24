import { describe, expect, it } from "vitest";
import {
  ADMIN_DOMAINS,
  BRAIN_SURFACES,
  EDITORIAL_TOOLS,
  OPERATIONS_TOOLS,
  calibrationMoves,
  collaboration,
  extractArgs,
  isAdminOperation,
  isChangeRequest,
  priorityOrder,
  resolveTool,
  surfaceAllows,
} from "@/lib/admin-intelligence";
import { APPROVAL_TOOLS, isApprovalTool } from "@/lib/brain-approvals";
import type { BrainAwareness } from "@/lib/brain-awareness";
import type { BrainReadings } from "@/lib/brain-readings";

describe("admin domain catalogue", () => {
  it("registers every domain with a unique id", () => {
    const ids = ADMIN_DOMAINS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const domain of ADMIN_DOMAINS) {
      expect(domain.label.length).toBeGreaterThan(0);
      expect(domain.purpose.length).toBeGreaterThan(10);
      expect(domain.examples.length).toBeGreaterThan(0);
    }
  });

  it("only lists tools that the approval queue actually implements", () => {
    for (const domain of ADMIN_DOMAINS) {
      for (const tool of domain.tools) {
        expect(isApprovalTool(tool), `${domain.id} lists ${tool}`).toBe(true);
        expect(APPROVAL_TOOLS[tool]).toBeDefined();
      }
    }
  });

  it("keeps every operations tool reachable from some domain", () => {
    // An operations tool no surface can request is dead weight; this asserts the
    // catalogue and the allowlist stay in step.
    for (const tool of OPERATIONS_TOOLS) {
      const reachable = ADMIN_DOMAINS.some((d) => d.tools.includes(tool));
      expect(reachable, `${tool} is not in any domain`).toBe(true);
    }
  });

  it("gives the read-only domains no tools at all", () => {
    const readOnly = ADMIN_DOMAINS.filter((d) => d.id === "audience" || d.id === "economy");
    for (const domain of readOnly) {
      expect(domain.tools).toHaveLength(0);
    }
  });
});

describe("the surface boundary", () => {
  it("declares both surfaces", () => {
    expect(BRAIN_SURFACES.map((s) => s.id).sort()).toEqual(["copilot", "operations"]);
  });

  it("gives the copilot no requestable tools", () => {
    const copilot = BRAIN_SURFACES.find((s) => s.id === "copilot")!;
    expect(copilot.tools).toHaveLength(0);
    for (const tool of [...OPERATIONS_TOOLS, ...EDITORIAL_TOOLS]) {
      expect(surfaceAllows("copilot", tool)).toBe(false);
    }
  });

  it("lets the operations surface request both families", () => {
    for (const tool of [...OPERATIONS_TOOLS, ...EDITORIAL_TOOLS]) {
      expect(surfaceAllows("operations", tool)).toBe(true);
    }
    expect(surfaceAllows("operations", "not_a_tool")).toBe(false);
  });

  it("splits the allowlist cleanly between the two families", () => {
    const all = Object.keys(APPROVAL_TOOLS).sort();
    const declared = [...OPERATIONS_TOOLS, ...EDITORIAL_TOOLS].sort();
    expect(declared).toEqual(all);
  });

  it("recognises only admin operations through the guard", () => {
    expect(isAdminOperation("run_hive_sweep")).toBe(true);
    expect(isAdminOperation("publish_post")).toBe(true);
    expect(isAdminOperation("rewrite_the_draft")).toBe(false);
  });
});

describe("change detection and routing", () => {
  it("separates a request for a change from a question", () => {
    expect(isChangeRequest("run a hive sweep")).toBe(true);
    expect(isChangeRequest("poll the feeds now")).toBe(true);
    expect(isChangeRequest("set self-heal to enforce")).toBe(true);
    expect(isChangeRequest("how many memories do you have")).toBe(false);
    expect(isChangeRequest("what is broken right now")).toBe(false);
  });

  it("prefers an explicitly named tool", () => {
    const domain = ADMIN_DOMAINS.find((d) => d.id === "pipelines")!;
    expect(resolveTool("please run retry_view_fold", domain)).toBe("retry_view_fold");
  });

  it("routes by the words in the request when no tool is named", () => {
    const pipelines = ADMIN_DOMAINS.find((d) => d.id === "pipelines")!;
    const mind = ADMIN_DOMAINS.find((d) => d.id === "mind")!;
    const sports = ADMIN_DOMAINS.find((d) => d.id === "sports")!;

    expect(resolveTool("the view counts are behind", pipelines)).toBe("retry_view_fold");
    expect(resolveTool("warm the edge cache again", pipelines)).toBe("rewarm_snapshots");
    expect(resolveTool("sweep the hive", mind)).toBe("run_hive_sweep");
    expect(resolveTool("diagnose the platform", mind)).toBe("run_brain_diagnosis");
    expect(resolveTool("teach the model from recent matches", sports)).toBe("run_sports_intelligence");
  });

  it("returns null rather than guessing when nothing matches", () => {
    const audience = ADMIN_DOMAINS.find((d) => d.id === "audience")!;
    expect(resolveTool("do the thing", audience)).toBeNull();
  });
});

describe("argument extraction", () => {
  it("pulls a cuid out of a sentence", () => {
    const id = "clabcdefghijklmnopqrstuvwx";
    expect(extractArgs(`flag comment ${id}`, "flag_comment")).toEqual({ commentId: id });
    expect(extractArgs(`publish ${id}`, "publish_post")).toEqual({ postId: id });
  });

  it("reads a repair mode", () => {
    expect(extractArgs("set self-heal to enforce", "set_repair_mode")).toEqual({ mode: "enforce" });
    expect(extractArgs("change the envelope to observe", "set_repair_mode")).toEqual({ mode: "observe" });
  });

  it("leaves arguments it cannot find out, so the filing path reports them missing", () => {
    expect(extractArgs("publish that story", "publish_post")).toEqual({});
  });
});

/* ── The deterministic assistant and the collaboration trace ─────────────── */

const awareness: BrainAwareness = {
  generatedAt: new Date().toISOString(),
  domains: [
    {
      id: "sports",
      label: "Sports prediction",
      headline: "Still learning — running on the base model",
      state: "unproven",
      facts: [{ label: "Learned lessons", value: "2 in the sports corpus" }],
      notes: ["Only 2 lessons in the corpus (the model needs 3 before the mind may move a prediction)."],
    },
    {
      id: "pipelines",
      label: "Pipelines",
      headline: "1 pipeline degraded",
      state: "warn",
      facts: [],
      notes: ["Scheduler: 3 jobs past their window."],
    },
  ],
  summary: { calibrated: 0, learning: 2, unknown: 0 },
};

const readings = {
  generatedAt: new Date().toISOString(),
  taken: 2,
  missing: 0,
  state: "warn" as const,
  text: "",
  readings: [
    { id: "audience", area: "Audience", label: "People", value: "10 total, 1 joined this week", state: "ok" as const },
    { id: "content", area: "Content", label: "Stories", value: "4 published", state: "ok" as const },
    { id: "pipelines", area: "Pipelines", label: "Scheduler", value: "3 jobs past their window", state: "warn" as const },
  ],
} as unknown as BrainReadings;

describe("calibration moves", () => {
  it("offers an operation for an unproven domain, and says so when it cannot act", () => {
    const moves = calibrationMoves(awareness);
    const sports = moves.find((m) => m.id === "sports-thin-corpus");
    expect(sports?.tool).toBe("run_sports_intelligence");
    expect(sports?.urgency).toBe("medium");

    const pipelines = moves.find((m) => m.id === "pipelines-degraded");
    expect(pipelines?.tool).toBe("run_brain_diagnosis");
  });

  it("never offers an operation for something only a person can do", () => {
    const economy: BrainAwareness = {
      generatedAt: new Date().toISOString(),
      domains: [
        {
          id: "economy",
          label: "Economy",
          headline: "2 payouts waiting",
          state: "warn",
          facts: [],
          notes: ["2 creator payouts are waiting."],
        },
      ],
      summary: { calibrated: 0, learning: 1, unknown: 0 },
    };
    const moves = calibrationMoves(economy);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.tool).toBeNull();
    expect(moves[0]!.manual).toBeTruthy();
  });

  it("orders by urgency", () => {
    const ordered = priorityOrder([
      { id: "a", domain: "x", title: "low", why: "", urgency: "low", tool: null },
      { id: "b", domain: "x", title: "high", why: "", urgency: "high", tool: null },
      { id: "c", domain: "x", title: "medium", why: "", urgency: "medium", tool: null },
    ]);
    expect(ordered.map((m) => m.urgency)).toEqual(["high", "medium", "low"]);
  });

  it("turns a critical tracked issue into a high-urgency move", () => {
    const moves = calibrationMoves(awareness, [
      {
        id: "i1",
        findingId: "view-sync-behind",
        status: "open",
        severity: "critical",
        area: "pipeline",
        title: "View sync is behind",
        detail: "160 views pending with no fold recorded.",
        fix: "Retry the fold.",
        subsystem: "platform-operations",
        occurrences: 3,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        resolvedAt: null,
        externalUrl: null,
        externalProvider: null,
      },
    ]);
    const move = moves.find((m) => m.id === "issue-i1");
    expect(move?.urgency).toBe("high");
    expect(move?.tool).toBe("run_brain_diagnosis");
  });
});

describe("collaboration trace", () => {
  it("degrades a subsystem whose calibration domain is not ok", () => {
    const trace = collaboration(readings, awareness);
    // `platform-actions` reads merely "warn", but the pipelines domain it is
    // mapped to is degraded, so the node must not render green.
    const actions = trace.subsystems.find((s) => s.id === "platform-actions");
    expect(actions?.state).toBe("warn");
    expect(actions?.evidence).toContain("calibration");
  });

  it("maps every awareness-linked subsystem to a real awareness domain", () => {
    const trace = collaboration(readings, awareness);
    const linked = trace.subsystems.filter((s) => s.evidence.includes("calibration"));
    expect(linked.length).toBeGreaterThan(0);
    for (const sub of linked) {
      expect(sub.state).not.toBe("ok");
    }
  });

  it("says readings could not be taken rather than reporting calm", () => {
    const trace = collaboration(null, null);
    // With nothing readable the board must not look calm — but it must not look
    // *broken* either. Every node is unproven, which is a separate bucket from
    // degraded: an engine nobody has observed is a gap in observation, and
    // counting it as a fault is what made a two-unmeasured-subsystem board read
    // as two broken engines.
    expect(trace.subsystems.every((s) => s.state === "unproven")).toBe(true);
    expect(trace.subsystems.some((s) => s.evidence.includes("could not be taken"))).toBe(true);
    expect(trace.degraded).toBe(0);
    expect(trace.unproven).toBe(trace.subsystems.length);
  });

  it("counts an unmeasurable reading as unproven, not degraded", () => {
    // A probe that could not be taken, and nothing that could. The node must not
    // carry a warning, because no warning was ever observed — but it must not be
    // green either, because nothing was measured.
    const blind = {
      generatedAt: new Date().toISOString(),
      taken: 0,
      missing: 1,
      state: "unknown" as const,
      text: "",
      readings: [
        { id: "rss-feeds", area: "Syndication", label: "Source feeds", value: "unavailable", state: "unknown" as const },
      ],
    } as unknown as BrainReadings;

    const trace = collaboration(blind, null);
    const research = trace.subsystems.find((s) => s.id === "neural-research");
    expect(research?.state).toBe("unproven");
    expect(trace.degraded).toBe(0);
    expect(trace.unproven).toBeGreaterThan(0);
  });

  it("keeps every declared hand-off pointing at a real engine", () => {
    const trace = collaboration(readings, awareness);
    const ids = new Set(trace.subsystems.map((s) => s.id));
    for (const link of trace.links) {
      expect(ids.has(link.from), `link from ${link.from}`).toBe(true);
      expect(ids.has(link.to), `link to ${link.to}`).toBe(true);
      expect(link.what.length).toBeGreaterThan(0);
    }
  });
});
