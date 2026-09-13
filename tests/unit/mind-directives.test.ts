import { describe, expect, it } from "vitest";
import {
  applyDirectives,
  extractDirectives,
  MAX_DIRECTIVE_GOALS_BIAS,
  MAX_DIRECTIVE_LEAN,
  parseDirective,
  type StoredDirective,
} from "../../src/lib/mind-directives";
import { consultMind, type MindMemory } from "../../src/lib/sports-intelligence";
import type { NormalizedMatch } from "../../src/lib/sports";

/**
 * Operator-directive contract.
 *
 * The admin chat can teach the combined mind standing instructions, and those
 * instructions then shift real predictions. That makes the parser a control
 * surface on the model, so the rules that must hold are strict:
 *
 *   • ordinary conversation NEVER becomes a directive;
 *   • a directive's effect is bounded, however it is phrased;
 *   • scope is honoured — a La Liga instruction cannot touch Serie A;
 *   • a directive about the away side pushes the lean the other way;
 *   • the influence is named in the rationale, never silent.
 */

const fixture = (overrides: Partial<NormalizedMatch> = {}): NormalizedMatch => ({
  externalId: "d1",
  provider: "demo",
  sport: "football",
  competition: "La Liga",
  country: "Spain",
  homeTeam: "Real Madrid",
  awayTeam: "Barcelona",
  homeScore: null,
  awayScore: null,
  status: "SCHEDULED",
  minute: null,
  kickoff: new Date().toISOString(),
  ...overrides,
});

/** Build a stored directive row exactly as `saveDirective` would write it. */
function stored(overrides: Partial<StoredDirective> = {}): StoredDirective {
  return {
    id: overrides.id ?? "dir-1",
    raw: overrides.raw ?? "Favour home teams in La Liga",
    scope: overrides.scope ?? { competition: "La Liga", team: null },
    target: overrides.target ?? "home",
    lean: overrides.lean ?? 0.12,
    goalsBias: overrides.goalsBias ?? 0,
    note: overrides.note ?? "Operator directive (La Liga): favours home sides by 12 points.",
    confidence: overrides.confidence ?? 0.7,
    active: overrides.active ?? true,
    createdBy: overrides.createdBy ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

describe("parseDirective — refuses to bend the model on ordinary chat", () => {
  const conversation = [
    "How is the platform health?",
    "What's trending right now?",
    "Give me the hive mind report",
    "Tell me about today's matches",
    "Which competition has the most fixtures?",
    "Thanks, that's helpful",
  ];

  it.each(conversation)("leaves %j alone", (message) => {
    expect(parseDirective(message)).toBeNull();
  });

  it("ignores an instruction verb that resolves to no effect", () => {
    // "always" is an instruction verb, but nothing here can be acted on.
    expect(parseDirective("I always enjoy the midweek fixtures")).toBeNull();
  });

  it("does not mistake a pronoun for a club name", () => {
    const parsed = parseDirective("Always trust them");
    expect(parsed).toBeNull();
  });
});

describe("parseDirective — recognises real instructions", () => {
  it("reads a home-lean with a competition scope", () => {
    const parsed = parseDirective("Favour home teams in La Liga");
    expect(parsed).not.toBeNull();
    expect(parsed!.target).toBe("home");
    expect(parsed!.lean).toBeGreaterThan(0);
    expect(parsed!.scope.competition).toBe("La Liga");
    expect(parsed!.scope.team).toBeNull();
  });

  it("reads a scoring instruction as a goal bias", () => {
    const parsed = parseDirective("Avoid high scoring in Serie A");
    expect(parsed).not.toBeNull();
    expect(parsed!.goalsBias).toBeLessThan(0);
    expect(parsed!.scope.competition).toBe("Serie A");
  });

  it("reads a negation on a home lean", () => {
    const parsed = parseDirective("Stop backing home teams in the Premier League");
    expect(parsed).not.toBeNull();
    expect(parsed!.lean).toBeLessThan(0);
    expect(parsed!.scope.competition).toBe("Premier League");
  });

  it("reads a named club as a team-scoped instruction", () => {
    const parsed = parseDirective("Strongly favour Gor Mahia");
    expect(parsed).not.toBeNull();
    expect(parsed!.scope.team).toBe("Gor Mahia");
    expect(parsed!.target).toBe("team");
    expect(parsed!.lean).toBeGreaterThan(0);
  });

  it("honours the explicit prefix even with no numeric effect", () => {
    const parsed = parseDirective("directive: treat cup fixtures cautiously");
    expect(parsed).not.toBeNull();
    expect(parsed!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("never exceeds the bounded effect", () => {
    const parsed = parseDirective("Strongly strongly always favour home teams over 5.5 in La Liga");
    expect(parsed).not.toBeNull();
    expect(Math.abs(parsed!.lean)).toBeLessThanOrEqual(MAX_DIRECTIVE_LEAN);
    expect(Math.abs(parsed!.goalsBias)).toBeLessThanOrEqual(MAX_DIRECTIVE_GOALS_BIAS);
  });
});

describe("applyDirectives — scope and direction", () => {
  it("applies a matching competition directive toward home", () => {
    const effect = applyDirectives([stored()], fixture());
    expect(effect.applied).toHaveLength(1);
    expect(effect.homeLean).toBeGreaterThan(0);
    expect(effect.notes.join(" ")).toContain("Operator directive");
  });

  it("ignores a directive for a different competition", () => {
    const effect = applyDirectives([stored()], fixture({ competition: "Serie A" }));
    expect(effect.applied).toHaveLength(0);
    expect(effect.homeLean).toBe(0);
  });

  it("flips the lean when the named club is the away side", () => {
    const directive = stored({
      scope: { competition: null, team: "Barcelona" },
      target: "team",
      lean: 0.12,
    });
    const effect = applyDirectives([directive], fixture());
    expect(effect.applied).toHaveLength(1);
    // Favouring the away side is expressed as a negative push on home.
    expect(effect.homeLean).toBeLessThan(0);
  });

  it("pushes the other way for an explicit away target", () => {
    const effect = applyDirectives([stored({ target: "away" })], fixture());
    expect(effect.homeLean).toBeLessThan(0);
  });

  it("does not apply a team directive to an unrelated fixture", () => {
    const directive = stored({ scope: { competition: null, team: "Gor Mahia" }, target: "team" });
    const effect = applyDirectives([directive], fixture());
    expect(effect.applied).toHaveLength(0);
  });

  it("caps the combined effect across several directives", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      stored({ id: `d${i}`, scope: { competition: null, team: null }, target: "home", lean: 0.18 })
    );
    const effect = applyDirectives(many, fixture());
    expect(effect.applied).toHaveLength(6);
    expect(effect.homeLean).toBeLessThanOrEqual(MAX_DIRECTIVE_LEAN);
    expect(Math.abs(effect.homeLean)).toBeLessThanOrEqual(MAX_DIRECTIVE_LEAN);
  });
});

describe("extractDirectives — stored rows", () => {
  const row = (metadata: string | null, overrides: Partial<MindMemory> = {}): MindMemory => ({
    source: "operator",
    category: "directive",
    content: "Favour home teams in La Liga",
    tags: "directive,competition:laliga,target:home",
    metadata,
    confidence: 0.7,
    ...overrides,
  });

  const meta = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      scope: { competition: "La Liga", team: null },
      target: "home",
      lean: 0.12,
      goalsBias: 0,
      note: "Operator directive (La Liga): favours home sides by 12 points.",
      confidence: 0.7,
      active: true,
      ...extra,
    });

  it("rehydrates an active directive", () => {
    expect(extractDirectives([row(meta())])).toHaveLength(1);
  });

  it("skips a revoked directive", () => {
    expect(extractDirectives([row(meta({ active: false }))])).toHaveLength(0);
  });

  it("skips malformed metadata rather than throwing", () => {
    expect(extractDirectives([row("{not json")])).toHaveLength(0);
    expect(extractDirectives([row(null)])).toHaveLength(0);
  });

  it("ignores sports memories that are not directives", () => {
    expect(
      extractDirectives([row(meta(), { source: "sports", category: "wisdom" })])
    ).toHaveLength(0);
  });

  it("clamps a tampered lean back into the safe band", () => {
    const [directive] = extractDirectives([row(meta({ lean: 99 }))]);
    expect(directive).toBeDefined();
    expect(directive!.lean).toBeLessThanOrEqual(MAX_DIRECTIVE_LEAN);
  });
});

describe("consultMind — directives reach the model", () => {
  const directiveMemory = (): MindMemory => ({
    source: "operator",
    category: "directive",
    content: "Favour home teams in La Liga",
    tags: "directive,competition:laliga,target:home",
    metadata: JSON.stringify({
      scope: { competition: "La Liga", team: null },
      target: "home",
      lean: 0.12,
      goalsBias: 0,
      note: "Operator directive (La Liga): favours home sides by 12 points.",
      confidence: 0.7,
      active: true,
    }),
    confidence: 0.7,
  });

  it("moves the momentum even with zero learned lessons", () => {
    const signal = consultMind([directiveMemory()], fixture());
    expect(signal.momentum.home).toBeGreaterThan(0.5);
    // Heat is floored so the instruction is actually felt in the grid.
    expect(signal.heat).toBeGreaterThanOrEqual(0.8);
    expect(signal.notes.join(" ")).toContain("Operator directive");
  });

  it("shifts the goal expectation for a scoring instruction", () => {
    const goals = directiveMemory();
    goals.metadata = JSON.stringify({
      scope: { competition: "La Liga", team: null },
      target: null,
      lean: 0,
      goalsBias: 0.5,
      note: "Operator directive (La Liga): raises expected goals by 0.50.",
      confidence: 0.7,
      active: true,
    });
    const signal = consultMind([goals], fixture());
    expect(signal.avgGoals).not.toBeNull();
    expect(signal.avgGoals!).toBeGreaterThan(2.6);
  });

  it("leaves an unrelated fixture untouched", () => {
    const signal = consultMind([directiveMemory()], fixture({ competition: "Serie A" }));
    expect(signal.momentum.home).toBe(0.5);
    expect(signal.heat).toBe(0);
    expect(signal.notes).toEqual([]);
  });

  it("ignores a directive that has been revoked", () => {
    const revoked = directiveMemory();
    revoked.metadata = JSON.stringify({
      scope: { competition: "La Liga", team: null },
      target: "home",
      lean: 0.12,
      goalsBias: 0,
      note: "Operator directive (La Liga): favours home sides by 12 points.",
      active: false,
    });
    const signal = consultMind([revoked], fixture());
    expect(signal.momentum.home).toBe(0.5);
    expect(signal.heat).toBe(0);
  });
});
