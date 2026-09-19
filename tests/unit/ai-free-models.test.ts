import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCODE_FREE_MODELS,
  OPENROUTER_FREE_MODELS,
  isFreeOpenCodeModel,
  isFreeOpenRouterModel,
} from "@/lib/ai-provider";

/**
 * Only free agents.
 *
 * This is a rule the provider will happily let us break: a paid model id does
 * not fail at the console, it fails at the first completion with
 * `CreditsError: No payment method` — which reads as an outage rather than a
 * configuration mistake. Three places have to agree for the rule to hold (the
 * static fallback, the live-roster filter and the console picker), so all three
 * are asserted here against the same predicate.
 */

/** The paid ids Zen actually publishes, so the test fails if one creeps back. */
const KNOWN_PAID_OPENCODE = [
  "claude-opus-5",
  "claude-sonnet-5",
  "gpt-5.5",
  "gemini-3.5-flash",
  "grok-4.6",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "glm-5.3",
  "minimax-m2.5",
  "kimi-k2.5",
  "qwen3.5-plus",
];

describe("the OpenCode free-tier predicate", () => {
  it("accepts the free ids and rejects the paid catalogue", () => {
    for (const id of OPENCODE_FREE_MODELS) {
      expect(isFreeOpenCodeModel(id), `${id} should be free`).toBe(true);
    }
    for (const id of KNOWN_PAID_OPENCODE) {
      expect(isFreeOpenCodeModel(id), `${id} should be refused`).toBe(false);
    }
  });

  it("refuses contributor-locked free models, which fail on another account", () => {
    expect(isFreeOpenCodeModel("muse-spark-1.3-contributor-free")).toBe(false);
    expect(isFreeOpenCodeModel("muse-spark-1.2-contributor-free")).toBe(false);
  });

  it("refuses empty and malformed ids", () => {
    expect(isFreeOpenCodeModel("")).toBe(false);
    expect(isFreeOpenCodeModel("   ")).toBe(false);
  });

  it("has no paid model in the static fallback list", () => {
    expect(OPENCODE_FREE_MODELS.length).toBeGreaterThan(0);
    for (const id of OPENCODE_FREE_MODELS) {
      expect(id.endsWith("-free") || id === "big-pickle", `${id} is not a free id`).toBe(true);
    }
  });
});

describe("the OpenRouter free-tier predicate", () => {
  it("accepts the static free list", () => {
    for (const id of OPENROUTER_FREE_MODELS) {
      expect(isFreeOpenRouterModel(id), `${id} should be free`).toBe(true);
    }
  });

  it("accepts suffix variants and refuses paid ids", () => {
    expect(isFreeOpenRouterModel("meta-llama/llama-3.3-70b-instruct:free")).toBe(true);
    expect(isFreeOpenRouterModel("anthropic/claude-sonnet-5")).toBe(false);
    expect(isFreeOpenRouterModel("openai/gpt-5.5")).toBe(false);
    expect(isFreeOpenRouterModel("")).toBe(false);
  });
});

/* ── The runtime guard ───────────────────────────────────────────────────── */

const settingsGet = vi.fn();
vi.mock("@/lib/settings", () => ({
  getSettings: (...a: unknown[]) => settingsGet(...a),
}));

const { getAiConfig } = await import("@/lib/ai-provider");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.OPENCODE_MODEL;
  delete process.env.OPENROUTER_MODEL;
});

describe("getAiConfig", () => {
  it("substitutes a paid OpenCode model with the free default", async () => {
    settingsGet.mockResolvedValue({
      aiProvider: "opencode",
      opencodeApiKey: "zen-key",
      opencodeModel: "claude-sonnet-5",
    });

    const config = await getAiConfig();
    expect(config.provider).toBe("opencode");
    expect(config.model).toBe("deepseek-v4-flash-free");
  });

  it("substitutes a paid OpenRouter model with the free default", async () => {
    settingsGet.mockResolvedValue({
      aiProvider: "openrouter",
      openrouterApiKey: "or-key",
      openrouterModel: "anthropic/claude-sonnet-5",
    });

    const config = await getAiConfig();
    expect(config.provider).toBe("openrouter");
    expect(config.model).toBe(OPENROUTER_FREE_MODELS[0]);
  });

  it("keeps a free model the admin chose", async () => {
    settingsGet.mockResolvedValue({
      aiProvider: "opencode",
      opencodeApiKey: "zen-key",
      opencodeModel: "mimo-v2.5-free",
    });

    const config = await getAiConfig();
    expect(config.model).toBe("mimo-v2.5-free");
  });

  it("falls back to the free default when no model is configured at all", async () => {
    settingsGet.mockResolvedValue({ aiProvider: "opencode", opencodeApiKey: "zen-key" });
    const config = await getAiConfig();
    expect(config.model).toBe("deepseek-v4-flash-free");
  });

  it("still returns builtin when nothing is keyed", async () => {
    settingsGet.mockResolvedValue({});
    const config = await getAiConfig();
    expect(config.provider).toBe("builtin");
    expect(config.model).toBe("");
  });
});
