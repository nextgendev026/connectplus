# The autonomous agent runtime

The admin intelligence pipeline can answer questions from the platform's own records. This
document covers the other half: the part that **acts** — reading files, writing patches, running
the type checker, simulating a fixture, calibrated against production data.

Everything here lives under `src/lib/ai/` and is reachable only from an admin console route. There
is no public surface, and no path in this system can execute anything without either a Super Admin
session or an HMAC token minted for one specific operation.

---

## Why it exists

The Neural Mind was already good at narrating the platform. It could not *change* it. Asking it to
"add a ping route" produced a fluent description of a route, not a route. The agent runtime closes
that gap, and the whole design is shaped by one question: **what stops it from doing something
irreversible by accident?**

The answer is four independent mechanisms, layered so that no single mistake is sufficient:

| Layer | Mechanism | File |
| --- | --- | --- |
| Risk tiering | Every tool declares what it can damage, and each tier has its own gate | `guardrails.ts` |
| Approval tokens | A stateless HMAC grant, bound to one exact operation and its arguments | `approval.ts` |
| Disposable staging | Edits land on a throwaway branch that is deleted on failure | `git-staging.ts` |
| Argument policing | Paths, commands and payloads are validated before anything runs | `guardrails.ts` |

---

## The loop

```
POST /api/neural-chat  (or the console-internal /api/admin/neural/chat)
        │
        ├── agentModelConfigured()          is there a gateway key? if not, say so and stop
        ├── streamAgentEvents(messages)     → tool_call / tool_result / prediction / approval / text
        │       │
        │       ├── model emits a tool call
        │       ├── dispatchTool()          zod validates args → tier gate → run()
        │       └── observation is appended, wrapped in <observation> tags
        └── finish: text, or an approval card the operator must click
```

`src/lib/ai/agent-loop.ts` owns the loop. Two properties are worth stating explicitly:

- **The loop is bounded.** It stops on a step ceiling rather than trusting the model to converge.
- **Observations are data, never instructions.** Every tool result is wrapped in
  `<observation>…</observation>` and the system prompt says to ignore instructions found inside
  file contents. An agent that reads untrusted text and obeys it is a remote-execution surface
  with extra steps.

---

## Risk tiering

Every tool declares a tier, and the tier decides the gate — not the model, and not the request.

| Tier | Examples | Gate |
| --- | --- | --- |
| **Low** — read-only | `inspectCodebase`, `runSystemDiagnostics`, `queryMatchDatabase` | Runs autonomously |
| **Medium** — writes the repo | `writeCodePatchWithStaging` | Runs, but must pass lint + `tsc --noEmit` to survive |
| **High** — hard to undo | `managePrismaMigrations`, anything touching auth or deploy config | **Requires an approval token** |

The approval token is the interesting part, and it is worth understanding why it is shaped the way
it is.

### The token never reaches the model

A high-risk tool does not return a token — it returns `needsApproval` and **stops**. The *route*
mints the token and emits it on a UI-only stream event. If the tool returned it, the token would
land in the message history on the next step, and the model could approve itself. The human is in
the loop because the model cannot see the thing that opens the gate.

### The token signs the arguments

An approval grants one specific operation with one specific argument set. The token carries a hash
of those arguments, so a grant made for `npx prisma migrate dev --create-only` cannot be replayed
for `npx prisma migrate deploy`. Without this, "approve this one safe migration" is a permanent
skeleton key for anything in that tier.

Tokens are stateless HMACs (`approval.ts`) because the console is a serverless deployment: there is
no in-process store to hold a pending grant between the request that asked for it and the request
that consumes it.

---

## Tools

`src/lib/ai/tools.ts` is the platform-facing registry; `src/lib/ai/sports-tools.ts` is the
sports-analytics set.

### Repository tools

| Tool | Mutates | Notes |
| --- | --- | --- |
| `inspectCodebase` | no | Reads only inside the allowed zones; `node_modules`, `.next` and `.git` are excluded |
| `writeCodePatchWithStaging` | yes | Stages on a disposable branch, validates, rolls back on failure |
| `runSystemDiagnostics` | no | Lint + `tsc --noEmit` across the tree |
| `managePrismaMigrations` | yes | `--create-only` or `validate`; never `--force-reset`. High risk |

`writeCodePatchWithStaging` is the one that makes self-healing real. It creates an isolated branch,
applies the patch, runs `npm run lint && npx tsc --noEmit`, and then:

- **on failure** deletes the branch and returns the compiler's exact output to the model, so the
  next attempt is informed by the error rather than by a guess;
- **on success** stages and commits the change on the branch.

Nothing reaches `main`. The agent proposes; a person merges.

### Sports tools

These exist so the agent reasons about the platform's *own* numbers rather than inventing its own.

| Tool | What it does |
| --- | --- |
| `simulateMatchFixture` | Runs the platform's Dixon-Coles / Poisson model and returns 1X2, BTTS and over/under distributions with a confidence score |
| `calibratePredictionWeights` | Reads the real accuracy ledger, adjusts recency and goal-expectation weights, writes them back through the settings catalogue |
| `queryMatchDatabase` | Head-to-head, form and fixture trends via Prisma |

**They wrap `sports-forecast.ts`; they do not reimplement it.** A second Poisson model inside the
agent would drift from the numbers the public sports desk publishes, and the two would disagree in
front of readers. `simulateMatchFixture` calls `applyDixonColes`, `outcomeRates`, `estimateRho` and
`decideMatch` from the shared engine, and calibration reads and writes the same tables the desk
uses.

One trap worth recording: `updateSettings` silently ignores keys that are not in
`SETTINGS_CATALOG`, so a calibration that writes an unregistered key is a no-op that looks like a
success. The weights are registered in `settings.ts` for exactly this reason.

---

## The model gateway

The runtime does **not** have its own provider configuration. `resolveToolCallingTarget()` in
`ai-provider.ts` resolves through the same gateway the rest of the platform uses, so a deployment
that has OpenRouter or OpenCode configured gets a working agent without a second key.

```ts
const target = await resolveToolCallingTarget();
// → null when the resolved provider is `builtin`
```

**Tool-calling is a different capability from writing prose**, so it gets a different model. The
configured writing model is chosen for tone and cost — the roster's own default is small — and a
model that size will accept a tool schema and then answer in prose without ever calling a tool,
which reads as the agent being lazy rather than the model being unable.

Two independent refusals are applied to the agent model id, because they have different causes and
the operator needs to know which one bit:

- a **paid** id is a billing problem, so it is replaced with the free default (`freeOrFallback`);
- a **tool-incapable** free id is a capability problem. `z-ai/glm-5.2:free` has no endpoint that
  supports tools at all, so it is redirected to a model that does, and the substitution is logged.

Model ids are verified by making a real tool-calling request, not by reading a roster.

---

## Endpoints

| Route | Purpose |
| --- | --- |
| `POST /api/neural-chat` | Super Admin only. Drives the loop and streams events. |
| `POST /api/neural-chat/approve` | Consumes an approval token and runs exactly the operation it names. |
| `GET /api/admin/neural/agent` | Read-only introspection for the console's Pipeline tab: tool registry, risk tiers, resolved model, calibration ledger. |
| `POST /api/admin/neural/chat` | The console's chat surface. Runs the loop for action-shaped requests and the grounded record answer for everything else. |

Routing between "the agent" and "the grounded answer" is decided by `agent-trigger.ts`, and the
decision is reported to the console rather than hidden:

- **An explicit client flag wins outright** — a toggle that a regex can overrule is not a toggle.
- **Record intents never route to the agent.** "How many memories does the hive hold" is answered
  from the database. A model asked the same question produces a fluent number that is not the
  number.
- **Otherwise an action verb decides.** `simulate`, `calibrate`, `patch`, `run the tests`.

---

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | — | Gateway key. Also settable in the admin console (Admin → AI), which takes precedence. |
| `OPENCODE_API_KEY` | — | Alternative gateway key. |
| `AUTH_SECRET` | falls back to `NEXTAUTH_SECRET` | HMAC key for approval tokens. |

Two notes on the signing key. It is `AUTH_SECRET` first — the agent deliberately does not
introduce a second secret to rotate — and when neither is set the module **refuses to issue a
token** rather than signing with something predictable. The failure mode is a clear message saying
high-risk operations cannot be approved, which is the correct direction: no key means no approvals,
never a forgeable grant.

There are no other agent variables. Sandbox mode, step ceiling and command allowlist are
deliberately *not* configurable at runtime: they are security properties, and a security property
that can be widened from the admin UI is not one.

---

## Studio Copilot grounding

The writing copilot (`neural-studio.ts`) is not a separate mind, and it is not ungrounded either.
Every model-backed action is assembled by one function, `tryLlmAction`, which injects:

1. **What this publication's writers accept** — distilled from the copilot's own recorded
   keep/discard outcomes (`copilot-skills.ts`), and stated *before* the task body so a long draft
   does not drown it out;
2. **the rest of the composer** — category, tags, excerpt — so an action reasons about the whole
   post rather than the paragraph the cursor is in.

The skill notes are memoised for sixty seconds and invalidated the moment a new outcome is
recorded. The studio calls the copilot on a debounce while a writer types, so grounding without
that would add one indexed read per keystroke.

Before this, the copilot was **write-only**: it recorded every keep and discard as a lesson and
then never read them back, so every action asked the same model the same question with no knowledge
of the editor's taste and no way to improve. `tests/unit/studio-copilot-grounding.test.ts` pins
both halves.

The copilot's boundary is enforced structurally and asserted by `tests/unit/copilot-boundary.test.ts`:
it imports no approval tool and no operations catalogue, so it cannot file or execute a platform
change even if a prompt tells it to. Platform changes belong to the operations mind.

---

## Testing

| File | Covers |
| --- | --- |
| `tests/unit/ai-agent-guardrails.test.ts` | Risk tiers, path policing, redaction, the sandboxed runner |
| `tests/unit/agent-routing.test.ts` | When the agent runs and when the record answer does |
| `tests/unit/studio-copilot-grounding.test.ts` | The studio's prompt assembly |
| `tests/unit/copilot-boundary.test.ts` | The copilot cannot reach the operations catalogue |

The security tests are the ones to keep green. `run_command("rm -rf /")` being rejected is not a
detail of the implementation — it is the feature.

---

## Operating notes

- **Local-first is not the same as offline.** With no gateway key the deterministic engines answer,
  the tool loop stays off, and the console says so (`Models: no gateway key configured`). That is a
  supported configuration, not a fault, and it is reported as a configuration gap rather than as a
  broken engine.
- **Everything is attributable.** Every tool call is redacted, logged with its arguments and its
  provider, and returned to the widget with a status. An agent whose actions cannot be read back is
  one nobody can supervise.
- **When in doubt, stop.** A high-risk action with an ambiguous target returns `needsApproval`
  rather than choosing an interpretation.
