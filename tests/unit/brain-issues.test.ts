import { describe, expect, it } from "vitest";
import { PERSISTENCE_THRESHOLD, issueKey, persistentFindings, subsystemFor } from "@/lib/brain-issues";
import { MAX_REPAIRS_PER_RUN, repairCatalog } from "@/lib/brain-repair";
import type { BrainDiagnosis, BrainDiagnostic } from "@/lib/app-brain";

/**
 * Which findings become issues is the whole judgement in the register, and it is
 * the part that is cheap to get wrong in a way nobody notices: file too eagerly
 * and the list is noise nobody reads, file too late and a standing fault hides
 * behind "it was busy that night".
 */

function finding(id: string, severity: BrainDiagnostic["severity"] = "warn"): BrainDiagnostic {
  return {
    id,
    area: "Scheduler",
    severity,
    title: `${id} is unhappy`,
    detail: `${id} detail`,
    fix: `fix ${id}`,
  };
}

function diagnosis(...findings: BrainDiagnostic[]): BrainDiagnosis {
  return { generatedAt: new Date().toISOString(), overall: "warn", checks: 8, healthy: [], findings };
}

describe("brain issues — what counts as persistent", () => {
  it("does not file a finding seen only once", async () => {
    expect(persistentFindings([], diagnosis(finding("scheduler-stale")))).toEqual([]);
  });

  it("files a finding once it has survived the threshold", async () => {
    const current = diagnosis(finding("scheduler-stale"));
    const history = [diagnosis(finding("scheduler-stale")), diagnosis(finding("scheduler-stale"))];

    const persisted = persistentFindings(history, current);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.findingId).toBe("scheduler-stale");
    expect(persisted[0]?.occurrences).toBe(PERSISTENCE_THRESHOLD);
  });

  it("stops counting at the first clean run", async () => {
    // Appeared, vanished, came back: two problems, not one long one. Treating it
    // as continuous would hide the reappearance and inflate the occurrence count
    // that a reader uses to judge how bad it is.
    const current = diagnosis(finding("hive"));
    const history = [diagnosis(), diagnosis(finding("hive")), diagnosis(finding("hive"))];

    expect(persistentFindings(history, current)).toEqual([]);
  });

  it("never files an informational finding", async () => {
    const current = diagnosis(finding("feed-checks", "info"));
    const history = [diagnosis(finding("feed-checks", "info")), diagnosis(finding("feed-checks", "info"))];
    expect(persistentFindings(history, current)).toEqual([]);
  });

  it("counts each finding independently within the same run", async () => {
    const current = diagnosis(finding("hive"), finding("convex"));
    const history = [
      diagnosis(finding("hive"), finding("convex")),
      diagnosis(finding("convex")), // the hive was healthy two runs ago
    ];

    const persisted = persistentFindings(history, current);
    // convex has three consecutive runs, the hive has two — one bad night and
    // one standing fault, filed as such rather than as a pair.
    expect(persisted.map((p) => p.findingId)).toEqual(["convex"]);
    expect(persisted[0]?.occurrences).toBe(3);
  });

  it("carries the evidence and the suspect subsystem onto the issue", async () => {
    const current = diagnosis(finding("scheduler-stale"));
    const history = [diagnosis(finding("scheduler-stale")), diagnosis(finding("scheduler-stale"))];
    const issue = persistentFindings(history, current)[0]!;

    // A bare finding id is not actionable; the subsystem pointer is what makes
    // an issue something a person can open and start working from.
    expect(issue.subsystem).toContain("cron-schedule");
    expect(issue.detail).toBe("scheduler-stale detail");
    expect(issue.fix).toBe("fix scheduler-stale");
    expect(issue.severity).toBe("warn");
  });

  it("says so honestly when it does not know where to look", async () => {
    expect(subsystemFor({ id: "who-knows", area: "Mystery" })).toContain("unknown");
  });

  it("keys an issue on a URI shape that a tracker link can sit beside", async () => {
    expect(issueKey("scheduler-stale")).toBe("brain-issue://scheduler-stale");
  });
});

describe("brain repair — the envelope", () => {
  it("keeps the catalogue small, explained and uniquely identified", async () => {
    const catalog = repairCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.length).toBeLessThanOrEqual(6);

    const ids = catalog.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const repair of catalog) {
      // Every repair must name the finding that authorises it, and justify
      // itself in a sentence — this list is what an operator reviews before
      // granting the envelope.
      expect(repair.findingId.length).toBeGreaterThan(2);
      expect(repair.title.length).toBeGreaterThan(5);
      expect(repair.why.length).toBeGreaterThan(40);
    }
  });

  it("caps the work a single diagnosis can trigger", async () => {
    expect(MAX_REPAIRS_PER_RUN).toBeLessThanOrEqual(3);
    expect(MAX_REPAIRS_PER_RUN).toBeGreaterThan(0);
  });

  it("binds every repair to a finding the diagnosis can actually raise", async () => {
    // A repair authorised by a finding id that no probe can produce is dead code
    // that reads as capability.
    const { runBrainSelfTest } = await import("@/lib/app-brain");
    expect(runBrainSelfTest().ok).toBe(true);

    const knownFindingIds = new Set([
      "database",
      "cache-tier",
      "scheduler",
      "scheduler-stale",
      "scheduler-failing",
      "pipeline",
      "convex",
      "hive",
      "self-test",
      "feeds",
    ]);
    for (const repair of repairCatalog()) {
      expect(knownFindingIds).toContain(repair.findingId);
    }
  });
});
