/**
 * When does the operator get the agent, and when do they get the deterministic
 * answer?
 *
 * This is the single most consequential routing decision in the console, and it has
 * a right answer that is not obvious. The Neural Mind answers most questions from
 * the platform's *own records* — job state, memory counts, revenue, calibration —
 * and that pathway is strictly better than a model for those, because the numbers
 * are read rather than recalled. A model asked "how many memories does the hive
 * hold" will produce a fluent number that is not the number.
 *
 * So the agent does not take over the console. It runs for the things only an agent
 * can do: reading real files, writing and validating a patch, running a simulation,
 * persisting a calibration. Everything else keeps the grounded answer it already
 * had.
 *
 * Three inputs, in priority order:
 *
 *   1. An explicit flag from the client, which wins outright. The console shows a
 *      toggle, and a toggle that can be overruled by a regex is not a toggle.
 *   2. A record intent — never routed to the agent. This is the check that prevents
 *      the agent from quietly replacing the answer an operator can trust.
 *   3. An action verb in the request.
 */

import { classifyIntent, isRecordIntent, type Intent } from "@/lib/neural-intent";

export interface TriggerDecision {
  run: boolean;
  /** Shown in the console, so the routing is visible rather than mysterious. */
  reason: string;
  intent: Intent;
}

/**
 * Verbs that mean "do something to the system", not "tell me something about it".
 *
 * Deliberately narrow and verb-first. "prediction" alone is not here — asking what
 * the model thinks about a fixture is a question, while "simulate the fixture" and
 * "calibrate the model" are tasks, and only the tasks need a tool loop.
 */
const ACTION_PATTERNS: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /\b(fix|patch|repair|refactor|implement|write|add|create|edit|rewrite|migrate)\b/i, what: "code change" },
  { re: /\b(simulate|run the model|backtest|calibrate|retune|re-?fit|tune)\b/i, what: "model run" },
  { re: /\b(inspect|read the (repo|code|file)|grep|search the code|look at the code)\b/i, what: "repository inspection" },
  { re: /\b(run (the )?(tests|lint|typecheck|diagnostics|build))\b/i, what: "diagnostics" },
  { re: /\b(pull|fetch|query) (the )?(fixture|match|h2h|head[- ]to[- ]head)\b/i, what: "fixture query" },
  { re: /\b(prisma|schema|migration)\b.*\b(change|update|add|create|generate|apply)\b/i, what: "schema work" },
];

export function shouldRunAgent(message: string, explicit?: unknown): TriggerDecision {
  const { intent } = classifyIntent(message);

  if (typeof explicit === "boolean") {
    return {
      run: explicit,
      reason: explicit
        ? "The operator asked for tools on this turn."
        : "The operator turned tools off for this turn.",
      intent,
    };
  }

  if (isRecordIntent(intent)) {
    return {
      run: false,
      reason: `"${intent}" is answered from the platform's own records, which is more accurate than asking a model to recall it.`,
      intent,
    };
  }

  const matched = ACTION_PATTERNS.find((p) => p.re.test(message));
  if (matched) {
    return { run: true, reason: `Recognised a ${matched.what} request.`, intent };
  }

  return {
    run: false,
    reason: "No action was requested, so the grounded answer is used.",
    intent,
  };
}
