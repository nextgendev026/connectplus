import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSettings, updateSettings, settingDef } from "@/lib/settings";
import {
  OPENROUTER_FREE_MODELS,
  OPENCODE_FREE_MODELS,
  fetchProviderModels,
  isFreeOpenCodeModel,
  isFreeOpenRouterModel,
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
 * fallback even on a fully configured install.
 *
 * Every list is filtered to the free tier, here as well as in the fetchers. Zen
 * publishes ~74 ids of which seven are free, so this is not belt-and-braces: it
 * is the difference between a picker an admin can use and one where most
 * choices answer `CreditsError: No payment method`. The filter runs on the way
 * out because this is the last point before the console renders the list.
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

  const freeOpenRouter = orModels.filter(isFreeOpenRouterModel);
  const freeOpenCode = ocModels.filter(isFreeOpenCodeModel);

  return [
    {
      name: "openrouter",
      label: "OpenRouter (Free)",
      keySetting: "openrouterApiKey",
      modelSetting: "openrouterModel",
      defaultModel: freeOpenRouter[0] || OPENROUTER_FREE_MODELS[0],
      models: freeOpenRouter.length > 0 ? freeOpenRouter : [...OPENROUTER_FREE_MODELS],
      note: `Free tier — ${freeOpenRouter.length} models, every one :free and free to run.`,
    },
    {
      name: "opencode",
      label: "OpenCode Zen (Free)",
      keySetting: "opencodeApiKey",
      modelSetting: "opencodeModel",
      defaultModel: freeOpenCode[0] || OPENCODE_FREE_MODELS[0],
      models: freeOpenCode.length > 0 ? freeOpenCode : [...OPENCODE_FREE_MODELS],
      note: `Free tier — ${freeOpenCode.length} models. Zen's paid catalogue is hidden: those ids need a billing method.`,
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
      const stored = settings[p.modelSetting] || "";
      const isFree = p.name === "openrouter" ? isFreeOpenRouterModel : isFreeOpenCodeModel;
      return {
        name: p.name,
        label: p.label,
        note: p.note,
        hasKey: Boolean(key),
        keyHint: key ? `••••${key.slice(-4)}` : null,
        // The stored model is shown as the effective one only if it is free; a
        // paid id left over from before is displayed as what will actually run,
        // so the console never claims a model the provider will refuse.
        model: stored && isFree(stored) ? stored : p.defaultModel,
        storedModel: stored || null,
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

  /*
   * Free only, refused with the reason.
   *
   * Without this an admin could save a paid id — by hand, or from a browser tab
   * left open before the roster changed — and every completion afterwards would
   * fail with the provider's credits error. Refusing at the boundary turns a
   * silent outage into a sentence in the console.
   */
  const isFree = def.name === "openrouter" ? isFreeOpenRouterModel : isFreeOpenCodeModel;
  if (!isFree(model)) {
    return NextResponse.json(
      {
        error: "Only free models are available",
        detail: `"${model}" is not a ${def.label} free model. Pick one from the list, or leave the model blank to use ${def.defaultModel}.`,
        freeModels: def.models,
      },
      { status: 400 }
    );
  }

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
