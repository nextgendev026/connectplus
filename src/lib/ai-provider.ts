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
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    extraHeaders: {
      // OpenRouter asks for an identifying referer/title on free traffic.
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://connectplusapp.vercel.app",
      "X-Title": "connectPlus",
    },
  },
  opencode: { baseUrl: "https://opencode.ai/zen/v1", defaultModel: "grok-code" },
};

/** Free-tier OpenRouter models the console offers out of the box. */
export const OPENROUTER_FREE_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-chat-v3-0324:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
] as const;

/** Curated OpenCode Zen models. */
export const OPENCODE_MODELS = [
  "grok-code",
  "qwen3-coder",
  "claude-sonnet-4",
  "gpt-5",
  "kimi-k2",
] as const;

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
      model: settings.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
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