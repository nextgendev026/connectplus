import { describe, expect, it } from "vitest";

/**
 * The provider registry.
 *
 * The property under test is **"can the admin console confirm a configuration
 * that does nothing"**, which must be no. That is the failure this registry was
 * built for, and it is why the assertions concentrate on the masked hint never
 * carrying a secret and on a non-routable provider never being reported as
 * configured.
 *
 * The correction that shaped the module is worth keeping visible: `openaiApiKey`
 * is *not* dead wiring — the image generator reads it. What was wrong was that the
 * console labelled it as text-model capability and probed it as AI provider
 * health. `consumedBy` is the field that keeps that distinction honest.
 */

const {
  ABSENT_PROVIDERS,
  CREDENTIAL_CONSUMERS,
  KNOWN_UNROUTABLE_NAMES,
  ROUTABLE_PROVIDERS,
  allCredentialSettingKeys,
  credentialConsumer,
  credentialFingerprint,
  maskSecretHint,
  nonGatewayCredentialSettingKeys,
  providerCredentialStatus,
  registryInvariants,
  retiredSettingKeys,
  routableProvider,
  routableProviderIds,
  routableSettingKeys,
  validateCredential,
} = await import("@/lib/providers/registry");

const noEnv = { settings: {}, env: {} };

describe("registry invariants", () => {
  it("passes its own structural invariants", () => {
    expect(registryInvariants()).toEqual([]);
  });

  it("registers exactly the providers the gateway can route", () => {
    // Pinned deliberately. A provider added to `ai-provider.ts` without a registry
    // entry would be invisible to the console; one added here without a gateway
    // record would offer a credential nothing reads. The drift test asserts the
    // same pairing against the source.
    expect(routableProviderIds()).toEqual(["openrouter", "opencode"]);
  });

  it("gives every routable provider an environment key and a console key", () => {
    for (const provider of ROUTABLE_PROVIDERS) {
      expect(provider.envKeys.length, provider.id).toBeGreaterThan(0);
      expect(provider.settingKeys.length, provider.id).toBeGreaterThan(0);
    }
  });

  it("uses HTTPS for every provider base URL", () => {
    // A plaintext provider endpoint would put a bearer token on the wire.
    for (const provider of ROUTABLE_PROVIDERS) {
      expect(provider.baseUrl.startsWith("https://"), provider.id).toBe(true);
    }
  });

  it("never lists the same id as both routable and absent", () => {
    const routable = new Set(routableProviderIds());
    for (const provider of ABSENT_PROVIDERS) expect(routable.has(provider.id)).toBe(false);
  });

  it("does not advertise as unsupported any provider it can route", () => {
    const routable = new Set(routableProviderIds());
    for (const name of KNOWN_UNROUTABLE_NAMES) expect(routable.has(name)).toBe(false);
  });
});

describe("retired and non-gateway credentials", () => {
  it("reports only Anthropic as a credential read by nothing", () => {
    // Derived from `consumedBy`, so this changes automatically if a consumer is
    // added or removed. A non-empty result means the console offers a field whose
    // value no query, request or job will read.
    expect(retiredSettingKeys()).toEqual(["anthropicApiKey"]);
  });

  it("records that the OpenAI key is live, for image generation", () => {
    // The audit's first version called this dead wiring. It is not: the image
    // generator reads it. What was wrong was the label and the health probe.
    const consumer = credentialConsumer("openaiApiKey");
    expect(consumer?.consumedBy).toBe("image-generation");
    expect(consumer?.consumer).toContain("visual-studio");
    expect(nonGatewayCredentialSettingKeys()).toContain("openaiApiKey");
  });

  it("never claims the AI gateway reads a credential no provider declares", () => {
    const gatewayKeys = new Set(routableSettingKeys());
    for (const consumer of CREDENTIAL_CONSUMERS) {
      if (consumer.consumedBy === "ai-gateway") expect(gatewayKeys.has(consumer.settingKey)).toBe(true);
    }
  });

  it("gives every credential consumer a note explaining what it does and does not enable", () => {
    for (const consumer of CREDENTIAL_CONSUMERS) {
      expect(consumer.note.length, consumer.settingKey).toBeGreaterThan(40);
    }
  });

  it("lists every credential key in one place, routable or not", () => {
    const all = allCredentialSettingKeys();
    for (const key of routableSettingKeys()) expect(all).toContain(key);
    for (const consumer of CREDENTIAL_CONSUMERS) expect(all).toContain(consumer.settingKey);
  });
});

describe("providerCredentialStatus", () => {
  it("reports absent for every routable provider with nothing configured", () => {
    const statuses = providerCredentialStatus(noEnv);
    for (const id of routableProviderIds()) {
      const status = statuses.find((s) => s.id === id);
      expect(status?.source, id).toBe("absent");
      expect(status?.maskedHint).toBeNull();
    }
  });

  it("prefers a console setting over the environment", () => {
    // The console is the more recent, more deliberate choice, and an operator who
    // pastes a key expects it to take effect without a redeploy.
    const statuses = providerCredentialStatus({
      settings: { openrouterApiKey: "sk-or-v1-abcdefghijklmno" },
      env: { OPENROUTER_API_KEY: "sk-or-v1-zzzzzzzzzzzzzzz" },
    });
    const openrouter = statuses.find((s) => s.id === "openrouter");
    expect(openrouter?.source).toBe("setting");
    expect(openrouter?.sourceKey).toBe("openrouterApiKey");
    expect(openrouter?.maskedHint).toBe("••••lmno");
  });

  it("falls back to the environment when no setting is present", () => {
    const statuses = providerCredentialStatus({ settings: {}, env: { OPENCODE_API_KEY: "oc-abcdefghijklmnop" } });
    const opencode = statuses.find((s) => s.id === "opencode");
    expect(opencode?.source).toBe("environment");
    expect(opencode?.sourceKey).toBe("OPENCODE_API_KEY");
  });

  it("never includes a credential value anywhere in its output", () => {
    // The whole point of the shape. Serialised and searched, so a future field
    // added carelessly fails this rather than shipping.
    const secret = "sk-or-v1-SUPERSECRETVALUE1234567890";
    const statuses = providerCredentialStatus({ settings: { openrouterApiKey: secret }, env: {} });
    expect(JSON.stringify(statuses)).not.toContain(secret);
    expect(JSON.stringify(statuses)).not.toContain("SECRETVALUE");
  });

  it("marks every non-gateway credential as not routable, even when configured", () => {
    // The false confirmation: a key that is stored, shown and probed while the AI
    // pipeline cannot use it.
    const statuses = providerCredentialStatus({ settings: { openaiApiKey: "sk-abcdefghijklmnop" }, env: {} });
    const openai = statuses.find((s) => s.id === "openaiApiKey");
    expect(openai?.routable).toBe(false);
    expect(openai?.problem).toContain("does NOT let the AI gateway call OpenAI");
  });

  it("explains an unread credential without implying it enables anything", () => {
    const statuses = providerCredentialStatus({ settings: { anthropicApiKey: "sk-ant-abcdefghijklmnop" }, env: {} });
    const anthropic = statuses.find((s) => s.id === "anthropicApiKey");
    expect(anthropic?.routable).toBe(false);
    expect(anthropic?.requirement).toContain("No module reads this key");
  });

  it("still reports an unread credential when nothing is set, so the reason is visible", () => {
    const statuses = providerCredentialStatus(noEnv);
    expect(statuses.find((s) => s.id === "anthropicApiKey")?.requirement).toContain("No module reads");
  });

  it("reports a provider name that does not exist as absent, never as configured", () => {
    const statuses = providerCredentialStatus({ settings: { aiProvider: "gemini" }, env: {} });
    expect(statuses.every((s) => s.id !== "gemini" || s.routable === false)).toBe(true);
  });
});

describe("maskSecretHint", () => {
  it("reveals only the last four characters", () => {
    expect(maskSecretHint("sk-or-v1-abcdefghijkl")).toBe("••••ijkl");
  });

  it("reveals nothing for a value short enough that four characters matter", () => {
    // Four of eight characters is half the credential — the mistake a "masked"
    // display usually makes.
    expect(maskSecretHint("abcdefghij")).toBeNull();
    expect(maskSecretHint("12345678901")).toBeNull();
  });

  it("reveals nothing for an empty or whitespace value", () => {
    expect(maskSecretHint("")).toBeNull();
    expect(maskSecretHint("        ")).toBeNull();
  });

  it("is not a substring of a long credential beyond the tail", () => {
    const hint = maskSecretHint("sk-live-0123456789abcdef");
    expect(hint).toBe("••••cdef");
    expect(hint).not.toContain("0123456789");
  });
});

describe("validateCredential", () => {
  it("accepts a plausible key", () => {
    expect(validateCredential("openrouter", "sk-or-v1-abcdefghijklmnop")).toEqual({ ok: true, problem: null });
  });

  it("refuses a credential the AI gateway cannot use, naming the real consumer", () => {
    // Storing one would create exactly the false confirmation this module exists
    // to prevent, so it is refused at the write rather than warned about after.
    //
    // The message distinguishes the two cases, because they need different
    // actions: OpenAI's key is refused for the *gateway* but is live for image
    // generation, while Anthropic's is read by nothing at all. Telling an operator
    // with an OpenAI key that it is "read by nothing" would be false.
    const openai = validateCredential("openai", "sk-abcdefghijklmnop");
    expect(openai.ok).toBe(false);
    expect(openai.problem).toContain("not an AI-gateway provider");
    expect(openai.problem).toContain("does NOT let the AI gateway call OpenAI");
  });

  it("says plainly when a credential is read by nothing at all", () => {
    const anthropic = validateCredential("anthropic", "sk-ant-abcdefghijklmnop");
    expect(anthropic.ok).toBe(false);
    expect(anthropic.problem).toContain("read by nothing");
  });

  it("refuses a credential for a provider that does not exist at all", () => {
    const gemini = validateCredential("gemini", "AIzaSyABCDEFGHIJKLMNOP");
    expect(gemini.ok).toBe(false);
    expect(gemini.problem).toContain("not implemented");
  });

  it("refuses a credential for an unknown provider id", () => {
    expect(validateCredential("not-a-provider", "sk-abcdefghijklmnop").problem).toContain("not a known provider");
  });

  it("refuses an empty value", () => {
    expect(validateCredential("openrouter", "   ").problem).toContain("empty");
  });

  it("refuses a placeholder, which otherwise stores cleanly and fails at the first call", () => {
    for (const placeholder of ["changeme", "your-key", "xxx", "TODO", "test", "dummy", "placeholder"]) {
      expect(validateCredential("openrouter", placeholder).ok, placeholder).toBe(false);
    }
  });

  it("refuses a truncated value", () => {
    expect(validateCredential("openrouter", "sk-short").problem).toContain("characters; a provider key is longer");
  });

  it("refuses whitespace inside a value", () => {
    expect(validateCredential("openrouter", "sk-or-v1-abcdefgh ijklmn").problem).toContain("whitespace");
  });

  it("refuses a pasted header rather than the key itself", () => {
    // The most common copy-paste mistake, and one that stores fine and fails at
    // the first request with an opaque 401.
    const result = validateCredential("openrouter", "Bearer sk-or-v1-abcdefghijkl");
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('"Bearer " prefix');
  });
});

describe("credentialFingerprint", () => {
  it("differs per provider for the same value, so copes are not conflated", () => {
    const value = "sk-or-v1-abcdefghijklmnop";
    expect(credentialFingerprint("openrouter", value)).not.toBe(credentialFingerprint("opencode", value));
  });

  it("is stable for the same provider and value", () => {
    const value = "sk-or-v1-abcdefghijklmnop";
    expect(credentialFingerprint("openrouter", value)).toBe(credentialFingerprint("openrouter", value));
  });

  it("returns nothing for a value too short to fingerprint meaningfully", () => {
    expect(credentialFingerprint("openrouter", "short")).toBeNull();
  });

  it("does not contain the credential", () => {
    const value = "sk-or-v1-abcdefghijklmnop";
    expect(credentialFingerprint("openrouter", value)).not.toContain("abcdefghijklmnop");
  });
});

describe("routableProvider", () => {
  it("returns the definition for a known provider and undefined for anything else", () => {
    expect(routableProvider("openrouter")?.defaultModel).toBe("z-ai/glm-5.2:free");
    expect(routableProvider("openai")).toBeUndefined();
    expect(credentialConsumer("nothing")).toBeUndefined();
  });
});
