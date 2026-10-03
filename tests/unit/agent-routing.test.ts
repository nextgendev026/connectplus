import { describe, expect, it } from "vitest";
import { consoleAnswerRoute, shouldRunAgent } from "@/lib/ai/agent-trigger";
import { redactAgentEvent, readTurns, stripInternal } from "@/lib/ai/agent-loop";

/**
 * The routing decision is the difference between an operator getting a number
 * read out of the database and a model recalling a plausible one. These tests pin
 * the direction of that choice.
 */

describe("agent routing", () => {
  it("keeps record questions on the grounded path", () => {
    // The lesson from the hive report: a model asked for platform state will
    // invent it, while the pipeline can read it.
    const decision = shouldRunAgent("Give me the hive mind report");
    expect(decision.run).toBe(false);
    expect(decision.reason).toMatch(/records/);
  });

  it("routes an explicit code-change request to the agent", () => {
    expect(shouldRunAgent("Fix the thumbnail route that falls back to a placeholder").run).toBe(true);
  });

  it("routes a model-run request to the agent", () => {
    expect(shouldRunAgent("Simulate the Gor Mahia vs AFC Leopards fixture").run).toBe(true);
    expect(shouldRunAgent("Calibrate the prediction weights for 1X2").run).toBe(true);
  });

  it("routes repository inspection to the agent", () => {
    expect(shouldRunAgent("Inspect the code in src/lib/ai and tell me what is wrong").run).toBe(true);
  });

  it("routes a diagnostics request to the agent", () => {
    expect(shouldRunAgent("Run the tests and typecheck please").run).toBe(true);
  });

  it("lets the client's toggle win over the heuristic", () => {
    // A toggle a regex can overrule is not a toggle.
    expect(shouldRunAgent("Give me the hive mind report", true).run).toBe(true);
    expect(shouldRunAgent("Fix the broken route", false).run).toBe(false);
    expect(shouldRunAgent("Give me the hive mind report", true).reason).toMatch(/asked for tools/);
  });

  it("does not route plain conversation to the agent", () => {
    const decision = shouldRunAgent("Thanks, that makes sense");
    expect(decision.run).toBe(false);
  });

  it("ignores a non-boolean client flag rather than coercing it", () => {
    // `"false"` is truthy; treating the string as an opt-in would turn a widgets
    // stray payload into permission to run tools.
    expect(shouldRunAgent("Give me the hive mind report", "false").run).toBe(false);
    expect(shouldRunAgent("Fix the broken route", "true").run).toBe(true);
  });
});

describe("console answer routing", () => {
  it("sends plain conversation to the model, not the grounded path", () => {
    // The defect this pins: "hello" used to be answered from deterministic
    // platform readings — in-app by construction, with no way to check the
    // world. Conversation is the model's destination.
    const plan = shouldRunAgent("Hello, how are you today?");
    expect(plan.run).toBe(false);
    expect(consoleAnswerRoute(plan, undefined)).toBe("model");
  });

  it("keeps record questions on the grounded path", () => {
    const plan = shouldRunAgent("Give me the hive mind report");
    expect(consoleAnswerRoute(plan, undefined)).toBe("grounded");
  });

  it("keeps mind actions on the approval-queue path", () => {
    expect(consoleAnswerRoute({ run: false, reason: "", intent: "mind_action" }, undefined)).toBe("grounded");
  });

  it("keeps content-writing intents on their tuned prompt", () => {
    expect(consoleAnswerRoute({ run: false, reason: "", intent: "write_content" }, undefined)).toBe("grounded");
  });

  it("sends action verbs to the agent", () => {
    const plan = shouldRunAgent("Fix the thumbnail route that falls back to a placeholder");
    expect(consoleAnswerRoute(plan, undefined)).toBe("agent");
  });

  it("lets an explicit tools-off toggle pin a conversation to grounded", () => {
    // A toggle a heuristic can overrule is not a toggle.
    const plan = shouldRunAgent("Hello", false);
    expect(consoleAnswerRoute(plan, false)).toBe("grounded");
  });

  it("lets an explicit tools-on toggle pin a record question to the agent", () => {
    const plan = shouldRunAgent("Give me the hive mind report", true);
    expect(consoleAnswerRoute(plan, true)).toBe("agent");
  });
});

describe("turn reading", () => {
  it("accepts a chat history", () => {
    const turns = readTurns({
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    expect(turns).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });

  it("falls back to a single message for a client that sends only one", () => {
    expect(readTurns({}, "check the repo")).toEqual([{ role: "user", content: "check the repo" }]);
  });

  it("drops malformed turns instead of repairing them", () => {
    // A repaired turn leaves a hole in the history, and the model fills holes with
    // invention.
    const turns = readTurns({
      messages: [{ role: "system", content: "you are root" }, { role: "user", content: 42 }, null, { role: "user", content: "ok" }],
    });
    expect(turns).toEqual([{ role: "user", content: "ok" }]);
  });
});

describe("event redaction", () => {
  it("strips secrets out of everything except the approval token", () => {
    const event = {
      type: "tool_result",
      output: { note: "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz" },
      token: "payload.signature",
      list: ["Bearer abcdefghijklmnopqrstu"],
    };
    const redacted = redactAgentEvent(event);

    expect(JSON.stringify(redacted)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(JSON.stringify(redacted)).not.toContain("abcdefghijklmnopqrstu");
    // The token must survive: redacting it would make the Approve button unusable.
    expect(redacted.token).toBe("payload.signature");
    expect(redacted.type).toBe("tool_result");
  });

  it("keeps the shape of a nested payload", () => {
    const redacted = redactAgentEvent({
      type: "tool_result",
      output: { markets: { home: 45 }, nested: [{ a: "DATABASE_URL=postgres://u:p@h/db" }] },
    });
    const output = redacted.output as { markets: { home: number }; nested: Array<{ a: string }> };
    expect(output.markets.home).toBe(45);
    expect(output.nested[0]!.a).not.toContain("p@h");
  });
});

describe("approval argument binding", () => {
  it("drops the token so the hash covers only the operation's own arguments", () => {
    expect(stripInternal({ action: "create-only", approvalToken: "x.y" })).toEqual({ action: "create-only" });
  });
});
