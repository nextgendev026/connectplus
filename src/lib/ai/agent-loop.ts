/**
 * The agent's tool loop, as a stream of events.
 *
 * This exists so there is exactly one implementation of "let the model call tools
 * and report what happened". Before it, the loop lived inside a route, which meant
 * a second route wanting the same behaviour had two options: duplicate it, or
 * import a Next.js route handler from another route handler. Duplication would
 * drift — the first fix to the approval gate would land in one copy — so the loop
 * is a generator here and the routes are thin.
 *
 * ## The event vocabulary
 *
 *   start               the loop began
 *   text                model prose, as it arrives (also mirrored as `chunk` for
 *                       the console, which already renders `chunk`)
 *   tool_call           a tool is about to run, with its risk tier
 *   tool_result         what it returned
 *   tool_error          it threw
 *   approval_request    a high-risk call is waiting on a human, with the token
 *   approval_unavailable the gate could not be opened (no signing secret)
 *   prediction          a typed view of a match simulation, so the console does
 *                       not have to know the shape of a tool payload to draw it
 *   error / done
 *
 * ## Why the approval token is minted here but never sent to the model
 *
 * A high-risk tool refuses and reports `needsApproval`. The *stream* then carries a
 * signed token addressed to the operator's browser. The model sees the refusal in
 * its message history and never sees the token, so it cannot approve itself. That
 * separation is the whole gate; it is worth restating wherever the token is minted.
 */

import { streamText, stepCountIs, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { resolveToolCallingTarget, type OpenAiCompatibleTarget } from "@/lib/ai-provider";
import { GuardrailError, redact } from "./guardrails";
import { hashArgs, issueApprovalToken, type AgentPrincipal } from "./approval";
import { agentSystemPrompt, agentTools, TOOL_RISK, isNeedsApproval } from "./tools";

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_STEPS = 10;
const MAX_TURN_CHARS = 20_000;
const MAX_TURNS = 24;

/**
 * The gateway and model the agent will actually use, or `null` for none.
 *
 * Resolved through the platform's own provider layer rather than from an
 * environment variable. This project's AI is configured in the admin console —
 * `aiProvider = openrouter`, with the key in `PlatformSetting` — so reading
 * `OPENAI_API_KEY` here would report "no model" on a deployment that has a working
 * gateway, and the agent would look unimplemented rather than unconfigured.
 */
export async function agentTarget(): Promise<OpenAiCompatibleTarget | null> {
  return resolveToolCallingTarget();
}

/** True when a tool loop can run at all. */
export async function agentModelConfigured(): Promise<boolean> {
  return (await agentTarget()) !== null;
}

/**
 * Coerce a request body into turns.
 *
 * Anything unrecognised is dropped rather than repaired: a malformed turn produced
 * a model call with a hole in it, and the model would fill the hole with
 * invention.
 */
export function readTurns(body: unknown, fallbackMessage?: unknown): AgentTurn[] {
  const raw = (body as { messages?: unknown } | null)?.messages;
  const turns: AgentTurn[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw.slice(-MAX_TURNS)) {
      const role = (entry as AgentTurn | null)?.role;
      const content = (entry as AgentTurn | null)?.content;
      if ((role === "user" || role === "assistant") && typeof content === "string") {
        turns.push({ role, content: content.slice(0, MAX_TURN_CHARS) });
      }
    }
  }

  // A console that has kept its history only in the DOM sends a single message;
  // accepting both shapes keeps the endpoint usable from either client.
  if (turns.length === 0 && typeof fallbackMessage === "string" && fallbackMessage.trim()) {
    turns.push({ role: "user", content: fallbackMessage.trim().slice(0, MAX_TURN_CHARS) });
  }

  return turns;
}

/** Read a property off a stream part without leaking `any` into the file. */
function prop(part: unknown, key: string): unknown {
  if (!part || typeof part !== "object") return undefined;
  return (part as Record<string, unknown>)[key];
}

function describeError(error: unknown): string {
  if (error instanceof GuardrailError) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

/**
 * Turn a gateway error into something an operator can act on.
 *
 * The failure this exists for is real and was hit in development: OpenRouter
 * answers `No endpoints found that support tool use. Try disabling "inspectCodebase"`
 * — which reads as advice to delete a tool, when the actual fix is to change the
 * model. A cryptic error sends the operator to the wrong file; naming the setting
 * sends them to the right one.
 */
function explainModelError(message: string): string {
  if (/support tool use|tool[_ ]?use|tool calling/i.test(message)) {
    return (
      `${message}\n\n` +
      "Diagnosis: the configured agent model cannot call tools, so the loop has nothing to drive. " +
      "This is a model capability, not a bug in the tool — do not remove the tool. " +
      "Fix it under Admin → Settings → API by setting `agentModel` to a tool-capable free model " +
      "(the default is nvidia/nemotron-3-super-120b-a12b:free). The panel at " +
      "Admin → Neural Mind → Pipeline reports the model that is actually in use."
    );
  }
  return message;
}

/**
 * Drop fields the approval path owns, so the hash covers only the real arguments.
 *
 * `approvalToken` is injected by the approval endpoint *after* a token exists, and
 * it must not be inside the hash it is verifying.
 */
export function stripInternal(input: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== "approvalToken") rest[key] = value;
  }
  return rest;
}

/** Tool arguments, remembered from the call so the result can be bound to them. */
const pendingInputs = new Map<string, unknown>();

function rememberToolInput(toolCallId: unknown, input: unknown): void {
  if (typeof toolCallId !== "string") return;
  pendingInputs.set(toolCallId, input);
  if (pendingInputs.size > 64) {
    const oldest = pendingInputs.keys().next().value;
    if (typeof oldest === "string") pendingInputs.delete(oldest);
  }
}

function lastToolInput(part: unknown): Record<string, unknown> {
  const id = String(prop(part, "toolCallId") ?? "");
  const remembered = pendingInputs.get(id);
  if (remembered && typeof remembered === "object") return remembered as Record<string, unknown>;
  // An empty object means the token binds to nothing, which is a *stricter*
  // binding than none — the failure direction that matters.
  const echoed = prop(part, "input");
  return echoed && typeof echoed === "object" ? (echoed as Record<string, unknown>) : {};
}

/**
 * Run the loop, yielding events.
 *
 * @throws GuardrailError if the caller is not a Super Admin. The check is repeated
 *   here even though every route does it, because this is the function that can
 *   actually write files.
 */
export async function* streamAgentEvents({
  actor,
  turns,
}: {
  actor: AgentPrincipal;
  turns: AgentTurn[];
}): AsyncGenerator<AgentEvent> {
  if (actor.role !== "SUPER_ADMIN" || !actor.actorId) {
    throw new GuardrailError("Super Admin access required", "not_super_admin");
  }

  const target = await agentTarget();
  if (!target) {
    yield {
      type: "error",
      message:
        "No model gateway is configured (the provider is `builtin`), so the tool loop cannot run. " +
        "Set a provider and key in the admin console's API settings, or keep using the reasoning " +
        "console, which answers from the platform's own records without a model.",
    };
    return;
  }

  // Any OpenAI-compatible gateway: OpenRouter and OpenCode Zen both speak this
  // shape, which is why one client serves the whole pipeline.
  const client = createOpenAI({
    apiKey: target.apiKey,
    baseURL: target.baseUrl,
    headers: target.extraHeaders,
  });
  const result = streamText({
    model: client(target.model),
    system: agentSystemPrompt(),
    messages: turns as ModelMessage[],
    tools: agentTools(actor),
    // A read → patch → validate → repair → validate cycle fits inside ten steps.
    // Bounded on purpose: an agent able to run unbounded tool calls against a live
    // repository is a denial of service against its own maintainer.
    stopWhen: stepCountIs(MAX_STEPS),
    onError: ({ error }) => {
      console.error("agent loop error:", error);
    },
  });

  let started = false;

  for await (const part of result.fullStream) {
    const kind = prop(part, "type");

    if (!started) {
      started = true;
      yield {
        type: "agent_start",
        model: target.model,
        provider: target.provider,
        maxSteps: MAX_STEPS,
        actor: actor.actorId,
      };
    }

    if (kind === "text-delta") {
      const delta = String(prop(part, "text") ?? "");
      if (!delta) continue;
      // Emitted twice under two names on purpose: `delta` is the agent's own
      // vocabulary, and `content` is what the existing console already knows how to
      // append to a streaming bubble. Sending both means the widget needs no
      // special case to show the model thinking out loud.
      yield { type: "text", delta, content: delta };
      continue;
    }

    if (kind === "tool-call") {
      const toolName = String(prop(part, "toolName") ?? "unknown");
      rememberToolInput(prop(part, "toolCallId"), prop(part, "input"));
      yield {
        type: "tool_call",
        toolCallId: prop(part, "toolCallId"),
        toolName,
        input: prop(part, "input"),
        risk: TOOL_RISK[toolName]?.tier ?? "unknown",
        blastRadius: TOOL_RISK[toolName]?.blastRadius,
      };
      continue;
    }

    if (kind === "tool-result") {
      const toolName = String(prop(part, "toolName") ?? "unknown");
      const output = prop(part, "output");
      const risk = TOOL_RISK[toolName]?.tier ?? "unknown";

      yield { type: "tool_result", toolCallId: prop(part, "toolCallId"), toolName, output, risk };

      /*
       * A simulation is promoted to its own typed event.
       *
       * The console could dig `markets` out of the tool payload, but then the shape
       * of a tool's return value would be a rendering contract, and changing the
       * tool would silently stop drawing the card. A named event makes the coupling
       * explicit and one-directional.
       */
      if (toolName === "simulateMatchFixture" && output && typeof output === "object" && "markets" in output) {
        yield { type: "prediction", prediction: output };
      }

      if (isNeedsApproval(output)) {
        const args = stripInternal(lastToolInput(part));
        try {
          const grant = issueApprovalToken({ actorId: actor.actorId, tool: output.tool, args }, output.summary);
          yield {
            type: "approval_request",
            tool: output.tool,
            args,
            argsHash: hashArgs(args),
            token: grant.token,
            summary: output.summary,
            danger: output.danger,
            blastRadius: TOOL_RISK[output.tool]?.blastRadius,
            expiresAt: grant.expiresAt,
          };
        } catch (error) {
          yield {
            type: "approval_unavailable",
            tool: output.tool,
            message: describeError(error),
          };
        }
      }
      continue;
    }

    if (kind === "tool-error") {
      yield {
        type: "tool_error",
        toolCallId: prop(part, "toolCallId"),
        toolName: prop(part, "toolName"),
        message: describeError(prop(part, "error")),
      };
      continue;
    }

    if (kind === "error") {
      yield { type: "error", message: explainModelError(describeError(prop(part, "error"))) };
      continue;
    }

    if (kind === "finish") {
      yield { type: "agent_done", finishReason: prop(part, "finishReason") };
    }
  }
}

/**
 * Redact an outgoing event, field by field.
 *
 * Applied at the boundary rather than at each call site, because an event is
 * assembled from tool output, model input and error text — and the field that gets
 * forgotten is the one that leaks. The approval token is deliberately exempt: it is
 * a signed capability for one call, addressed to this operator's browser, and
 * redacting it would make the Approve button unusable.
 */
export function redactAgentEvent(event: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    out[key] = key === "token" ? value : redactValue(value);
  }
  return out;
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v)]),
    );
  }
  return value;
}
