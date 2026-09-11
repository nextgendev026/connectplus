import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSettings, updateSettings, settingDef } from "@/lib/settings";
import {
  OPENCODE_MODELS,
  OPENROUTER_FREE_MODELS,
  type AiProviderName,
} from "@/lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROVIDERS: {
  name: Exclude<AiProviderName, "builtin">;
  label: string;
  keySetting: string;
  modelSetting: string;
  defaultModel: string;
  models: string[];
  note: string;
}[] = [
  {
    name: "openrouter",
    label: "OpenRouter",
    keySetting: "openrouterApiKey",
    modelSetting: "openrouterModel",
    defaultModel: OPENROUTER_FREE_MODELS[0],
    models: [...OPENROUTER_FREE_MODELS],
    note: "Free tier — models suffixed :free cost nothing.",
  },
  {
    name: "opencode",
    label: "OpenCode Zen",
    keySetting: "opencodeApiKey",
    modelSetting: "opencodeModel",
    defaultModel: OPENCODE_MODELS[0],
    models: [...OPENCODE_MODELS],
    note: "Curated coding/writing models from opencode.ai/zen.",
  },
  {
    name: "openai",
    label: "OpenAI",
    keySetting: "openaiApiKey",
    modelSetting: "openaiModel",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"],
    note: "Paid.",
  },
  {
    name: "anthropic",
    label: "Anthropic",
    keySetting: "anthropicApiKey",
    modelSetting: "anthropicModel",
    defaultModel: "claude-3-5-haiku-latest",
    models: ["claude-3-5-haiku-latest", "claude-3-5-sonnet-latest"],
    note: "Paid.",
  },
];

async function requireAdmin() {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  if (!session?.user) return { error: NextResponse.json({ error: "Authentication required" }, { status: 401 }) };
  if (role !== "ADMIN" && role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  }
  return {};
}

export async function GET() {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const active = (settings.aiProvider || "builtin").toLowerCase();

  return NextResponse.json({
    active: active === "builtin" ? "builtin" : active,
    providers: PROVIDERS.map((p) => {
      const key = settings[p.keySetting] || "";
      return {
        name: p.name,
        label: p.label,
        note: p.note,
        hasKey: Boolean(key),
        keyHint: key ? `••••${key.slice(-4)}` : null,
        model: settings[p.modelSetting] || p.defaultModel,
        models: p.models,
      };
    }),
  });
}

/**
 * `action: "save"` writes provider / key / model to the settings store;
 * `action: "test"` fires a one-token completion so an admin can verify a key
 * before saving it. Both accept a key that has not been stored yet.
 */
export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (guard.error) return guard.error;

  const body = await request.json().catch(() => null);
  const action = body?.action === "save" ? "save" : "test";
  const provider = typeof body?.provider === "string" ? body.provider : "";
  const def = PROVIDERS.find((p) => p.name === provider);
  if (!def) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const providedKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  const key = providedKey || settings[def.keySetting] || "";
  const model = (typeof body?.model === "string" && body.model.trim()) || settings[def.modelSetting] || def.defaultModel;

  if (!key) return NextResponse.json({ error: "Add an API key for this provider first" }, { status: 400 });

  if (action === "save") {
    if (!settingDef(def.keySetting) || !settingDef(def.modelSetting)) {
      return NextResponse.json({ error: "Provider settings are not catalogued" }, { status: 500 });
    }
    const patch: Record<string, string> = {
      aiProvider: def.name,
      [def.modelSetting]: model,
    };
    if (providedKey) patch[def.keySetting] = providedKey;

    await updateSettings(patch);
    return NextResponse.json({ ok: true, provider: def.name, model, active: true });
  }

  // Test: minimal chat completion against the provider.
  const started = Date.now();
  try {
    const baseUrl =
      def.name === "openrouter"
        ? "https://openrouter.ai/api/v1"
        : def.name === "opencode"
          ? "https://opencode.ai/zen/v1"
          : def.name === "openai"
            ? "https://api.openai.com/v1"
            : "https://api.anthropic.com/v1";

    if (def.name === "anthropic") {
      const res = await fetch(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with the single word: ready" }],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      const ok = res.ok;
      const detail = ok ? undefined : (await res.text().catch(() => "")).slice(0, 200);
      return NextResponse.json({ ok, latencyMs: Date.now() - started, model, detail });
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(def.name === "openrouter"
          ? { "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://connectplusapp.vercel.app", "X-Title": "connectPlus" }
          : {}),
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
      }),
      signal: AbortSignal.timeout(25_000),
    });

    const data = await res.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content;
    return NextResponse.json({
      ok: res.ok,
      latencyMs: Date.now() - started,
      model,
      reply: typeof text === "string" ? text.trim().slice(0, 120) : undefined,
      detail: res.ok ? undefined : JSON.stringify(data)?.slice(0, 200),
    });
  } catch (e) {
    return NextResponse.json({
      ok: false,
      latencyMs: Date.now() - started,
      model,
      detail: e instanceof Error ? e.message : "Request failed",
    });
  }
}
