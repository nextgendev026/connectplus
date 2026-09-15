import { getSettings } from "@/lib/settings";
import type { Intent } from "@/lib/neural-intent";

export type AiProviderName = "builtin" | "openai" | "anthropic" | "openrouter" | "opencode";

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
type GatewayName = "openai" | "openrouter" | "opencode";

const OPENAI_COMPATIBLE: Record<
  GatewayName,
  { baseUrl: string; defaultModel: string; extraHeaders?: Record<string, string> }
> = {
  openai: { baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "z-ai/glm-5.2:free",
    extraHeaders: {
      // OpenRouter asks for an identifying referer/title on free traffic.
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://connectplusapp.vercel.app",
      "X-Title": "connectPlus",
    },
  },
  opencode: { baseUrl: "https://opencode.ai/zen/v1", defaultModel: "deepseek-v4-flash" },
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

/** OpenCode Zen models — refreshed roster. The API is the source of truth;
 *  these static fallbacks only apply when the endpoint is unreachable or
 *  unconfigured. Keep the list in sync by polling `opencode.ai/zen/v1/models`
 *  and wiring whatever the API returns as the clickable model list rather than
 *  a hard-coded roster.
 */
export const OPENCODE_MODELS = [
  "deepseek-v4-flash",
  "glm-5.3-flash",
  "kimi-k2.5",
  "qwen3.5-plus",
  "minimax-m2.5",
  "gemini-3.5-flash",
  "claude-sonnet-4",
  "claude-haiku-4-5",
  "gpt-5",
  "gpt-5.4-mini",
] as const;

/** Models confirmed working via OpenCode Zen API (paid tier). */
export const OPENCODE_PAID_MODELS = [
  "deepseek-v4-flash",
  "glm-5.3-flash",
  "glm-5.3",
  "kimi-k2.5",
  "kimi-k2.6",
  "qwen3.5-plus",
  "qwen3.6-plus",
  "minimax-m2.5",
  "minimax-m2.7",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3-flash",
  "claude-sonnet-4",
  "claude-haiku-4-5",
  "gpt-5",
  "gpt-5.4-mini",
] as const;

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
    const models: string[] = data?.data
      ?.filter((m: { id: string; pricing?: { prompt: string; completion: string } }) => {
        const priced = m.pricing ? parseFloat(m.pricing.prompt) === 0 && parseFloat(m.pricing.completion) === 0 : false;
        return (m.id.endsWith(":free") || priced) && isChatCapableModel(m.id);
      })
      .map((m: { id: string }) => m.id)
      .slice(0, 30) ?? [];
    return models.length > 0 ? models : [...OPENROUTER_FREE_MODELS];
  } catch {
    return [...OPENROUTER_FREE_MODELS];
  }
}

/**
 * Fetch available models from OpenCode Zen API.
 * Falls back to static list when the API is unreachable.
 */
export async function fetchOpenCodeModels(keyOverride?: string): Promise<string[]> {
  try {
    const key = keyOverride || process.env.OPENCODE_API_KEY || "";
    if (!key) return [...OPENCODE_MODELS];
    const res = await fetch("https://opencode.ai/zen/v1/models", {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [...OPENCODE_MODELS];
    const data = await res.json();
    const models: string[] = data?.data
      ?.map((m: { id: string }) => m.id)
      .filter((id: string) => !id.includes("contributor-free")) // exclude environment-locked free models
      .slice(0, 30) ?? [];
    return models.length > 0 ? models : [...OPENCODE_MODELS];
  } catch {
    return [...OPENCODE_MODELS];
  }
}

/**
 * Anthropic fallback when no key is available to ask the live list.
 *
 * Deliberately a `-latest` alias rather than a dated id: Anthropic ships
 * dated snapshots and retires them, and the alias is the one identifier that
 * keeps resolving without a code change. A keyed install overrides it with
 * whatever `/v1/models` reports.
 */
export const ANTHROPIC_FALLBACK_MODEL = "claude-3-5-haiku-latest";

/** OpenAI chat models used when the live `/v1/models` list cannot be read. */
export const OPENAI_FALLBACK_MODELS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] as const;

/** Anthropic models used when the live `/v1/models` list cannot be read. */
export const ANTHROPIC_FALLBACK_MODELS = [
  ANTHROPIC_FALLBACK_MODEL,
  "claude-3-5-sonnet-latest",
] as const;

/**
 * Live model list for OpenAI, so the admin console shows what the account can
 * actually call rather than a hand-written list that ages out silently.
 *
 * `keyOverride` exists because a key saved through the admin console lives in
 * the settings store, not in the environment — without it a keyed install would
 * still see only the static fallback and the console would look unrefreshed.
 */
export async function fetchOpenAiModels(keyOverride?: string): Promise<string[]> {
  try {
    const key = keyOverride || process.env.OPENAI_API_KEY || "";
    if (!key) return [...OPENAI_FALLBACK_MODELS];
    const res = await fetch("https://api.openai.com/v1/models", {
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [...OPENAI_FALLBACK_MODELS];
    const data = await res.json();
    const models: string[] = (data?.data ?? []) 
      .map((m: { id: string }) => m.id)
      .filter((id: string) => isChatCapableModel(id))
      .sort();
    return models.length > 0 ? models : [...OPENAI_FALLBACK_MODELS];
  } catch {
    return [...OPENAI_FALLBACK_MODELS];
  }
}

/**
 * Live model list for Anthropic. Same contract as the other fetchers: it never
 * throws, and it always answers with something the console can render.
 */
export async function fetchAnthropicModels(keyOverride?: string): Promise<string[]> {
  try {
    const key = keyOverride || process.env.ANTHROPIC_API_KEY || "";
    if (!key) return [...ANTHROPIC_FALLBACK_MODELS];
    const res = await fetch("https://api.anthropic.com/v1/models", {
      signal: AbortSignal.timeout(10_000),
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (!res.ok) return [...ANTHROPIC_FALLBACK_MODELS];
    const data = await res.json();
    const models: string[] = (data?.data ?? []).map((m: { id: string }) => m.id);
    return models.length > 0 ? models : [...ANTHROPIC_FALLBACK_MODELS];
  } catch {
    return [...ANTHROPIC_FALLBACK_MODELS];
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
    case "openai":
      return fetchOpenAiModels(keyOverride);
    case "anthropic":
      return fetchAnthropicModels(keyOverride);
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
    openai: {
      key: settings.openaiApiKey || process.env.OPENAI_API_KEY || "",
      model: settings.openaiModel || process.env.OPENAI_MODEL || OPENAI_COMPATIBLE.openai.defaultModel,
    },
    anthropic: {
      key: settings.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "",
      model: settings.anthropicModel || process.env.ANTHROPIC_MODEL || ANTHROPIC_FALLBACK_MODEL,
    },
    openrouter: {
      key: settings.openrouterApiKey || process.env.OPENROUTER_API_KEY || "",
      model: settings.openrouterModel || process.env.OPENROUTER_MODEL || OPENAI_COMPATIBLE.openrouter.defaultModel,
    },
    opencode: {
      key: settings.opencodeApiKey || process.env.OPENCODE_API_KEY || "",
      model: settings.opencodeModel || process.env.OPENCODE_MODEL || OPENAI_COMPATIBLE.opencode.defaultModel,
    },
  };

  const isProvider = (value: string): value is Exclude<AiProviderName, "builtin"> => value in keys;

  // An explicit console choice wins when it has a key.
  if (isProvider(providerSetting) && keys[providerSetting].key) {
    return { provider: providerSetting, apiKey: keys[providerSetting].key, model: keys[providerSetting].model };
  }

  // Otherwise prefer a free gateway (OpenRouter → OpenCode) before paid ones.
  for (const name of ["openrouter", "opencode", "openai", "anthropic"] as const) {
    if (keys[name].key) return { provider: name, apiKey: keys[name].key, model: keys[name].model };
  }

  return { provider: "builtin", apiKey: "", model: "" };
}

export function isContentIntent(intent: Intent): boolean {
  return CONTENT_INTENTS.includes(intent);
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

    if (cfg.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: cfg.model,
          system: opts.system,
          messages: [{ role: "user", content: opts.user }],
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text: string | undefined = data?.content?.[0]?.text;
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