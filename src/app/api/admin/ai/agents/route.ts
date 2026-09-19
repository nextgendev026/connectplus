import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSettings, updateSettings, settingDef } from "@/lib/settings";
import {
  OPENROUTER_FREE_MODELS,
  OPENCODE_MODELS,
  fetchProviderModels,
  type AiProviderName,
} from "@/lib/ai-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Build the provider list with dynamically-fetched models.
 *
 * The stored settings are passed in because a key saved through this console
 * lives in the settings store rather than the environment: without it, every
 * provider that only read `process.env` would keep rendering its static
 * fallback even on a fully configured install. All four platforms now answer
 * from their live API when they can and from a real fallback when they cannot.
 */
async function buildProviders(settings: Record<string, string>): Promise<{
  name: Exclude<AiProviderName, "builtin">;
  label: string;
  keySetting: string;
  modelSetting: string;
  defaultModel: string;
  models: string[];
  note: string;
}[]> {
  const [orModels, ocModels] = await Promise.all([
    fetchProviderModels("openrouter"),
    fetchProviderModels("opencode", settings.opencodeApiKey),
  ]);
  return [
    {
      name: "openrouter",
      label: "OpenRouter (Free)",
      keySetting: "openrouterApiKey",
      modelSetting: "openrouterModel",
      defaultModel: orModels[0] || OPENROUTER_FREE_MODELS[0],
      models: orModels,
      note: `Free tier — ${orModels.length} models available, all :free cost nothing.`,
    },
    {
      name: "opencode",
      label: "OpenCode Zen (Free)",
      keySetting: "opencodeApiKey",
      modelSetting: "opencodeModel",
      defaultModel: ocModels[0] || OPENCODE_MODELS[0],
      models: ocModels.length > 0 ? ocModels : [...OPENCODE_MODELS],
      note: `Free tier — ${ocModels.length} models available.`,
    },
  ];
}

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
  const providers = await buildProviders(settings);

  return NextResponse.json({
    active: active === "builtin" ? "builtin" : active,
    providers: providers.map((p) => {
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
  const settings = await getSettings().catch(() => ({} as Record<string, string>));
  const providers = await buildProviders(settings);
  const def = providers.find((p) => p.name === provider);
  if (!def) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });

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
        : "https://opencode.ai/zen/v1";

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
