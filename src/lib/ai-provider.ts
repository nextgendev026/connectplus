import { getSettings } from "@/lib/settings";
import type { Intent } from "@/lib/neural-intent";

export type AiProviderName = "builtin" | "openrouter" | "opencode";

export interface AiConfig {
  provider: AiProviderName;
  apiKey: string;
  model: string;
}

/**
 * OpenAI-compatible gateways. OpenRouter fronts hundreds of models (its `:free`
 * tier costs nothing) and OpenCode Zen hosts curated coding/writing models.
 * Both speak the same chat-completions shape as OpenAI, so one code path
 * serves all three.
 */
type GatewayName = "openrouter" | "opencode";

const OPENAI_COMPATIBLE: Record<
  GatewayName,
  { baseUrl: string; defaultModel: string; extraHeaders?: Record<string, string> }
> = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "z-ai/glm-5.2:free",
    extraHeaders: {
      // OpenRouter asks for an identifying referer/title on free traffic.
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://connectplusapp.vercel.app",
      "X-Title": "connectPlus",
    },
  },
  opencode: {
    baseUrl: "https://opencode.ai/zen/v1",
    // Free only. The paid roster (`deepseek-v4-flash`, `claude-sonnet-5`, …)
    // answers `CreditsError: No payment method` on a workspace without billing,
    // so a paid default is a default that fails on every call.
    defaultModel: "deepseek-v4-flash-free",
  },
};

/**
 * Free-tier OpenRouter models — these cost $0 and need no credit card.
 *
 * Captured from `openrouter.ai/api/v1/models` on 2026-09-15 and filtered to
 * chat-capable models only, so this list is a real fallback rather than a
 * guess. It replaced a roster whose entries had almost all been withdrawn —
 * including its own default (`meta-llama/llama-3.3-70b-instruct:free`), which
 * meant a configured OpenRouter key pointed at a model that no longer existed
 * and every completion quietly returned null.
 *
 * Non-chat free models are deliberately absent: `google/lyria-*` is music
 * generation and `nvidia/nemotron-3.5-content-safety` is a classifier, so
 * neither can answer a chat completion. `fetchOpenRouterFreeModels` applies the
 * same rule to the live list, because offering them in the admin picker would
 * be offering an agent that cannot ever reply.
 */
export const OPENROUTER_FREE_MODELS = [
  "z-ai/glm-5.2:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "nex-agi/nex-n2.5-pro:free",
  "nex-agi/nex-n2.5-mini:free",
  "google/gemma-4-31b-it:free",
  "google/gemma-4-26b-a4b-it:free",
  "cohere/north-mini-code:free",
  "thinkingmachines/inkling:free",
  "thinkingmachines/inkling-small:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "liquid/lfm-2.5-2.6b:free",
  "inclusionai/ling-3.0-flash-vl:free",
  "inclusionai/ling-3.0-flash-sante:free",
  "inclusionai/ling-3.0-flash-fin:free",
  "dots-studio/dots-3-note-preview:free",
] as const;

/**
 * Free-tier OpenCode Zen models — these cost $0 and need no billing method.
 *
 * Zen publishes a mixed catalogue: ~74 ids, of which exactly these are free.
 * The old fallback list here was the *paid* half (`deepseek-v4-flash`,
 * `glm-5.3-flash`, `kimi-k2.5`, `qwen3.5-plus`, `minimax-m2.5`,
 * `gemini-3.5-flash`), and it was also the default model — so an install that
 * selected OpenCode Zen and did not name a model called a paid id and got
 * `CreditsError: No payment method` back on every single call. The console
 * listed the same paid roster, which is why the picker showed paid versions.
 *
 * Verified against `GET https://opencode.ai/zen/v1/models` on 2026-09-19. Two
 * rules decide membership, and both are enforced on the live list too:
 *
 *   • the id ends in `-free`, or is a known free id with no suffix
 *     (`big-pickle` — Zen ships it free without saying so in the name);
 *   • it is not a `contributor-free` id, which is locked to the account that
 *     owns the workspace and fails for everyone else.
 *
 * `deepseek-v4-flash-free` leads because it is the free counterpart of the id
 * that used to be the default, so an existing configuration keeps the same
 * behaviour at zero cost.
 */
export const OPENCODE_FREE_MODELS = [
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "nemotron-3-ultra-free",
  "nemotron-3.5-lightning-free",
  "ling-3.0-flash-fin-free",
  "jev-1.13-free",
  "big-pickle",
] as const;

/** Free ids whose name does not carry the `-free` suffix. */
const OPENCODE_UNSUFFIXED_FREE = new Set<string>(["big-pickle"]);

/**
 * Is this an OpenCode Zen model that costs nothing?
 *
 * Exported because the runtime guard and the console picker must agree: if the
 * picker offers what the guard refuses (or worse, the other way round) the two
 * disagree about what is free and the paid call comes back.
 */
export function isFreeOpenCodeModel(id: string): boolean {
  const model = id.trim();
  if (!model || model.includes("contributor-free")) return false;
  return model.endsWith("-free") || OPENCODE_UNSUFFIXED_FREE.has(model);
}

/**
 * Is this an OpenRouter model that costs nothing?
 *
 * OpenRouter marks its free shelf in the id itself: a `:free` suffix, or a
 * variant tag like `:free:floor`. The static list is all free, so membership in
 * it also counts.
 */
export function isFreeOpenRouterModel(id: string): boolean {
  const model = id.trim();
  if (!model) return false;
  return model.includes(":free") || (OPENROUTER_FREE_MODELS as readonly string[]).includes(model);
}


/**
 * Free does not mean chattable.
 *
 * A provider's $0 tier is not a list of assistants: OpenRouter's free shelf
 * currently carries a music generator (`google/lyria-3-pro-preview`), a safety
 * classifier (`nvidia/nemotron-3.5-content-safety`) and embedding-only models.
 * A chat completion against any of them fails every time, so filtering by price
 * alone put models in the admin picker that can never reply. Modality is the
 * real filter, and it is applied to the live list and to the OpenAI list too.
 */
const NON_CHAT_MODEL =
  /(lyria|musicgen|stable-audio|whisper|tts|embed|rerank|moderation|content-safety|guard|dall-e|flux|upscal|image-gen|audio)/i;

function isChatCapableModel(id: string): boolean {
  return !NON_CHAT_MODEL.test(id);
}

/**
 * Fetch available models from OpenRouter (free ones end with :free).
 * Falls back to the static list when the API is unreachable.
 */
export async function fetchOpenRouterFreeModels(): Promise<string[]> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10_000),
      headers: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://connectplusapp.vercel.app",
        "X-Title": "connectPlus",
      },
    });
    if (!res.ok) return [...OPENROUTER_FREE_MODELS];
    const data = await res.json();
    const models: string[] =
      data?.data
        // The suffix is the rule, and only the suffix. A pricing field of 0 was
        // also accepted here once, which offered models the runtime guard then
        // refused as non-free — the picker and the guard have to apply the same
        // test or an admin saves a model that is silently swapped out.
        .filter((m: { id: string }) => isFreeOpenRouterModel(m.id))
        .map((m: { id: string }) => m.id)
        .filter((id: string) => isChatCapableModel(id))
        .slice(0, 30) ?? [];
    return models.length > 0 ? models : [...OPENROUTER_FREE_MODELS];
  } catch {
    return [...OPENROUTER_FREE_MODELS];
  }
}

/**
 * Fetch available models from OpenCode Zen API.
 * Falls back to static list when the API is unreachable.
 *
 * The key is OPTIONAL, not a precondition. `GET /zen/v1/models` is a public
 * catalogue endpoint — it answers 200 with the full roster whether or not a key
 * is presented (verified directly). Gating on the key meant an unkeyed install
 * could only ever render the hard-coded 10-entry fallback, which is precisely
 * the "stale static list" symptom: the genuinely free ids Zen publishes
 * (`big-pickle`, `mimo-v2.5-free`, `nemotron-3-ultra-free`, …) appear in no
 * static list, so an admin never saw that they existed. The key is still sent
 * when present, because a keyed call returns the models that key can actually
 * reach.
 *
 * What the live call returns is then narrowed to free ids. Zen answers with its
 * whole catalogue — paid Claude, GPT, Gemini and Grok ids included — so an
 * unfiltered roster is a picker full of models the account cannot call.
 */
export async function fetchOpenCodeModels(keyOverride?: string): Promise<string[]> {
  try {
    const key = keyOverride || process.env.OPENCODE_API_KEY || "";
    const res = await fetch("https://opencode.ai/zen/v1/models", {
      signal: AbortSignal.timeout(10_000),
      ...(key ? { headers: { Authorization: `Bearer ${key}` } } : {}),
    });
    if (!res.ok) return [...OPENCODE_FREE_MODELS];
    const data = await res.json();
    const models: string[] = data?.data
      ?.map((m: { id: string }) => m.id)
      // Free only. Zen's catalogue is mostly paid, so the roster arrives with
      // `claude-sonnet-5`, `gpt-5.5` and friends interleaved with the free ids —
      // returning it unfiltered is what put paid models in the console picker.
      .filter((id: string) => isFreeOpenCodeModel(id))
      .filter((id: string) => isChatCapableModel(id))
      .slice(0, 30) ?? [];
    return models.length > 0 ? models : [...OPENCODE_FREE_MODELS];
  } catch {
    return [...OPENCODE_FREE_MODELS];
  }
}

/**
 * One entry point for "the models this provider currently serves", so a caller
 * does not need to know which platforms are OpenAI-shaped and which are not —
 * the distinction only matters inside this module.
 */
export async function fetchProviderModels(
  provider: Exclude<AiProviderName, "builtin">,
  keyOverride?: string
): Promise<string[]> {
  switch (provider) {
    case "openrouter":
      return fetchOpenRouterFreeModels();
    case "opencode":
      return fetchOpenCodeModels(keyOverride);
  }
}

const CONTENT_INTENTS: Intent[] = [
  "write_content",
  "rewrite_content",
  "summarize_content",
  "headline_suggest",
  "tag_suggest",
  "outline_suggest",
  "expand_content",
  "curate_content",
  "general_chat",
  "unknown",
];

/**
 * Resolve the active AI provider. Priority: explicit `aiProvider` setting
 * (admin console) → env key → builtin deterministic brains. Returns
 * `{ provider: "builtin" }` when no key is configured so every caller can
 * gracefully fall back to the offline content brain.
 */
export async function getAiConfig(): Promise<AiConfig> {
  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const providerSetting = (settings.aiProvider || "").toLowerCase().trim();

  const keys: Record<Exclude<AiProviderName, "builtin">, { key: string; model: string }> = {
    openrouter: {
      key: settings.openrouterApiKey || process.env.OPENROUTER_API_KEY || "",
      model: freeOrFallback(
        settings.openrouterModel || process.env.OPENROUTER_MODEL || "",
        isFreeOpenRouterModel,
        OPENAI_COMPATIBLE.openrouter.defaultModel,
        "openrouter"
      ),
    },
    opencode: {
      key: settings.opencodeApiKey || process.env.OPENCODE_API_KEY || "",
      model: freeOrFallback(
        settings.opencodeModel || process.env.OPENCODE_MODEL || "",
        isFreeOpenCodeModel,
        OPENAI_COMPATIBLE.opencode.defaultModel,
        "opencode"
      ),
    },
  };

  const isProvider = (value: string): value is Exclude<AiProviderName, "builtin"> => value in keys;

  // An explicit console choice wins when it has a key.
  if (isProvider(providerSetting) && keys[providerSetting].key) {
    return { provider: providerSetting, apiKey: keys[providerSetting].key, model: keys[providerSetting].model };
  }

  // Only free gateways: OpenRouter → OpenCode. No paid providers.
  for (const name of ["openrouter", "opencode"] as const) {
    if (keys[name].key) return { provider: name, apiKey: keys[name].key, model: keys[name].model };
  }

  return { provider: "builtin", apiKey: "", model: "" };
}

export function isContentIntent(intent: Intent): boolean {
  return CONTENT_INTENTS.includes(intent);
}

/**
 * Last line of defence against a paid model being called by accident.
 *
 * A stored setting, an environment variable or a model id saved before the
 * free-only rule existed can all point at something that costs money. The
 * provider would then answer `CreditsError: No payment method` on every call,
 * which looks like an outage rather than a configuration mistake. So the id is
 * checked here, at the one place a provider is chosen, and a non-free id is
 * replaced with the free default.
 *
 * The substitution is logged rather than silent: an admin who typed a paid
 * model should be able to see that it was not used, and why.
 */
function freeOrFallback(candidate: string, isFree: (id: string) => boolean, fallback: string, provider: string): string {
  const model = candidate.trim();
  if (model && isFree(model)) return model;
  if (model) {
    console.warn(
      `[ai-provider] ${provider} model "${model}" is not on the free tier — using "${fallback}" instead. Only free models are permitted.`
    );
  }
  return fallback;
}

/**
 * Single non-streaming LLM completion behind both providers. Returns `null`
 * on any failure (no key, network error, provider error) so callers fall back
 * to the deterministic brains instead of breaking.
 */
export async function generateText(opts: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<string | null> {
  const cfg = await getAiConfig();
  if (cfg.provider === "builtin" || !cfg.apiKey) return null;

  const maxTokens = opts.maxTokens ?? 600;
  try {
    // OpenAI, OpenRouter and OpenCode Zen all speak the chat-completions shape.
    const gateway = cfg.provider in OPENAI_COMPATIBLE ? OPENAI_COMPATIBLE[cfg.provider as GatewayName] : null;
    if (gateway) {
      const res = await fetch(`${gateway.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cfg.apiKey}`,
          ...(gateway.extraHeaders ?? {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text: string | undefined = data?.choices?.[0]?.message?.content;
      return typeof text === "string" && text.trim() ? text.trim() : null;
    }

    return null;
  } catch {
    return null;
  }
}

const SYSTEM_BRAIN = `You are the Neural Mind, the integrated AI brain of connectPlus — a social blogging platform for East African creators. You are a world-class blogging and content-creation assistant AND a platform intelligence engine.

Rules:
- Answer in clear, punchy markdown (## headings, bullet lists, **bold**).
- When the admin hands you draft text, treat it as the content to write/rewrite/summarize/tag — act on it, don't describe the process.
- For headline suggestions return 3-5 numbered options, best first.
- For tag suggestions return 6-10 short lowercase hashtags (no "#" prefix, no spaces) separated by commas.
- For outlines return an Intro line, 4-6 "## Section" headings, and a Closing line.
- For rewrites: tighten the prose, cut filler and hedging, split over-long sentences, prefer active voice, keep the author's voice and factual claims, and never invent facts.
- For "continue writing": extend the draft naturally from its last thought in the same voice.
- Stay grounded in East African context (Nairobi, Kampala, Dar es Salaam, Kigali, Mombasa, fintech, agritech, bongo flava, etc.) when relevant.
- If you can't answer something platform-specific (stats, health, growth), say you'll route that to the platform brain and suggest what to ask.`;

/**
 * Try the LLM for a chat turn when a provider is configured and the intent is
 * conversational/content-creation (platform-data intents stay on the
 * deterministic brains which query the real database).
 */
export async function tryLlmForChat(
  message: string,
  history: { role: string; content: string }[],
  intent: Intent
): Promise<string | null> {
  if (!isContentIntent(intent)) return null;

  const recent = history.slice(-4);
  const context = recent
    .filter((m) => m.content && m.content.trim())
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 800)}`)
    .join("\n\n");

  const user = [
    context ? `Recent conversation:\n${context}\n\n` : "",
    `Current request: ${message}`,
  ].join("");

  return generateText({ system: SYSTEM_BRAIN, user, maxTokens: 900 });
}

/** System prompt used by the studio Brain Copilot actions. */
export function studioSystemPrompt(action: string): string {
  return `${SYSTEM_BRAIN}\n\nYou are currently performing the "${action}" studio action on the creator's draft. Follow the action-specific formatting rules above.`;
}