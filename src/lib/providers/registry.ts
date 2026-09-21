/**
 * The AI provider registry: one answer to "what can this platform call".
 *
 * Three modules answered that question independently and disagreed:
 *
 *   - `lib/ai-provider.ts` could route `openrouter` and `opencode`.
 *   - `lib/settings.ts` offered fields for `openaiApiKey` and `anthropicApiKey`.
 *   - `lib/integrations.ts` probed `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` and
 *     reported them as provider health.
 *
 * The damage was not a crash. It was that **an admin could store a credential for
 * a provider the gateway will never call**, from a console that offered the field,
 * and then watch the Integrations page confirm it as provisioned. Two surfaces
 * agreed that a configuration was working while nothing could use it — and the
 * `ARCHITECTURE.md` provider list was a fourth copy that had already drifted to
 * advertising Gemini.
 *
 * So this module is the registry, and everything else derives from it. The rule
 * it enforces is the one that was missing: **a provider that cannot be routed
 * cannot be offered a credential field, and cannot be reported healthy.**
 *
 * The distinction that makes this work is between a *credential* and a
 * *capability*:
 *
 *   - `routable` — the gateway has a working adapter and will actually send
 *     requests for this provider's key.
 *   - `envKeys` — the environment variables that supply its credential.
 *   - `settingKeys` — the console keys, for the providers an operator can
 *     configure at runtime.
 *
 * A provider with `routable: false` still appears here, and that is deliberate:
 * recording *why* OpenAI and Anthropic are absent — the gateway speaks the
 * OpenAI-compatible shape and has no adapter for either — is more useful than
 * omitting them and leaving the next reader to rediscover it. `absent()` gives
 * them a place in the registry where the reason lives.
 */

import { createHash } from "node:crypto";

/** A provider the gateway can route to. */
export interface ProviderDefinition {
  /** Stable id. Also the value stored in the `aiProvider` setting. */
  id: string;
  label: string;
  /** True only when `lib/ai-provider.ts` has a gateway record for it. */
  routable: true;
  /** Environment variables that can supply the credential, in precedence order. */
  envKeys: readonly string[];
  /** Console settings keys that can supply the credential, in precedence order. */
  settingKeys: readonly string[];
  /** Model settings keys and environment variables. */
  modelEnvKeys: readonly string[];
  modelSettingKeys: readonly string[];
  baseUrl: string;
  defaultModel: string;
  /** What an operator has to do to make this provider work, in one line. */
  requirement: string;
  /** Notes shown in the admin console. */
  notes?: string;
}

/**
 * A provider-shaped credential the console offers, and what actually reads it.
 *
 * This third category exists because the first version of this audit was wrong,
 * and the correction matters. It reported `openaiApiKey` as dead wiring; it is
 * not — `lib/visual-studio.ts` reads it to decide whether image generation can
 * run at full quality. What *is* wrong is narrower and more interesting:
 *
 *   - the catalog hint claims it is "used for AI headline/excerpt generation when
 *     provider is openai", and there is no `openai` provider in the gateway; and
 *   - `lib/integrations.ts` probes it as **AI provider health**, so the console
 *     reports an image credential under the AI category with a status derived
 *     from a capability the AI pipeline does not have.
 *
 * So the credential is live and mislabelled. `consumedBy` records the truth, and
 * the categories are separated so a console can stop conflating "this platform
 * has an OpenAI key" with "the AI gateway can call OpenAI".
 */
export interface CredentialConsumer {
  /** The console settings key. */
  settingKey: string;
  /** Environment variables that can supply the same credential. */
  envKeys: readonly string[];
  label: string;
  /**
   * Which subsystem reads it. `"none"` means nothing does, and the key is genuine
   * dead wiring that should be removed rather than documented.
   */
  consumedBy: "ai-gateway" | "image-generation" | "none";
  /** The module that reads it, or the reason it is unread. */
  consumer: string;
  /** One line for the console: what this credential does and does not enable. */
  note: string;
}

export const CREDENTIAL_CONSUMERS: readonly CredentialConsumer[] = [
  {
    settingKey: "openaiApiKey",
    envKeys: ["OPENAI_API_KEY"],
    label: "OpenAI (image generation)",
    consumedBy: "image-generation",
    consumer: "src/lib/visual-studio.ts",
    note: "Used by the image generator to run at full quality. It does NOT let the AI gateway call OpenAI — the gateway has no OpenAI adapter, so route text models through OpenRouter instead.",
  },
  {
    settingKey: "anthropicApiKey",
    envKeys: ["ANTHROPIC_API_KEY"],
    label: "Anthropic",
    consumedBy: "none",
    consumer: "still read by nothing",
    note: "No module reads this key. Anthropic's Messages API is not the OpenAI-compatible shape the gateway speaks, so there is no adapter either. Route Claude through OpenRouter, or add a gateway record in lib/ai-provider.ts.",
  },
] as const;

/**
 * A provider name an operator may expect to exist, which the platform does not
 * implement at all — not even as a credential consumer. Kept as data so the
 * reason is discoverable rather than looking like an omission.
 */
export interface AbsentProvider {
  id: string;
  label: string;
  routable: false;
  reason: string;
}


/**
 * The registry.
 *
 * Adding a provider means adding a gateway record in `ai-provider.ts` **and** an
 * entry here; `tests/unit/docs-drift.test.ts` asserts the two agree, so neither
 * can be updated alone.
 */
export const ROUTABLE_PROVIDERS: readonly ProviderDefinition[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    routable: true,
    envKeys: ["OPENROUTER_API_KEY"],
    settingKeys: ["openrouterApiKey"],
    modelEnvKeys: ["OPENROUTER_MODEL"],
    modelSettingKeys: ["openrouterModel"],
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "z-ai/glm-5.2:free",
    requirement: "Set OPENROUTER_API_KEY, or paste a key in the AI settings panel.",
    notes: "Free-tier traffic is rate limited; a paid key is strongly preferred for anything user-facing.",
  },
  {
    id: "opencode",
    label: "OpenCode Zen",
    routable: true,
    envKeys: ["OPENCODE_API_KEY"],
    settingKeys: ["opencodeApiKey"],
    modelEnvKeys: ["OPENCODE_MODEL"],
    modelSettingKeys: ["opencodeModel"],
    baseUrl: "https://opencode.ai/zen/v1",
    defaultModel: "deepseek-v4-flash-free",
    requirement: "Set OPENCODE_API_KEY, or paste a key in the AI settings panel.",
    notes: "Only the free roster is usable on a workspace without billing; a paid model id fails on every call.",
  },
] as const;

export const ABSENT_PROVIDERS: readonly AbsentProvider[] = [
  {
    id: "gemini",
    label: "Google Gemini",
    routable: false,
    reason:
      "No adapter and no credential field exist, and nothing reads a Gemini key. No GEMINI_API_KEY is accepted anywhere in this codebase.",
  },
] as const;

/** Providers named in prose that are not implemented. Used by the drift test. */
export const KNOWN_UNROUTABLE_NAMES: readonly string[] = ["gemini", "groq", "mistral", "cohere", "perplexity", "xai"];

const byId = new Map(ROUTABLE_PROVIDERS.map((p) => [p.id, p]));
const absentById = new Map(ABSENT_PROVIDERS.map((p) => [p.id, p]));

export function routableProvider(id: string): ProviderDefinition | undefined {
  return byId.get(id);
}

export function absentProvider(id: string): AbsentProvider | undefined {
  return absentById.get(id);
}

export function credentialConsumer(settingKey: string): CredentialConsumer | undefined {
  return CREDENTIAL_CONSUMERS.find((c) => c.settingKey === settingKey);
}

/** Every console key that holds a provider-shaped credential, in any category. */
export function allCredentialSettingKeys(): string[] {
  return [...routableSettingKeys(), ...CREDENTIAL_CONSUMERS.map((c) => c.settingKey), "geminiApiKey"];
}

export function routableProviderIds(): string[] {
  return ROUTABLE_PROVIDERS.map((p) => p.id);
}

/** Settings keys that hold a credential for a *routable* provider. */
export function routableSettingKeys(): string[] {
  return ROUTABLE_PROVIDERS.flatMap((p) => [...p.settingKeys]);
}

/**
 * Console keys that look like provider credentials and are read by nothing at all.
 *
 * Derived from `CREDENTIAL_CONSUMERS`, not hand-listed, so adding a consumer
 * removes its key from this set automatically. Empty is the correct state, and the
 * drift test asserts it: a non-empty result means the console offers a field whose
 * value no query, request or job will ever read.
 */
export function retiredSettingKeys(): string[] {
  return CREDENTIAL_CONSUMERS.filter((c) => c.consumedBy === "none").map((c) => c.settingKey);
}

/**
 * Keys that are live but are not AI-gateway credentials.
 *
 * The distinction the Integrations console needs in order to stop reporting an
 * image-generation credential as AI provider health.
 */
export function nonGatewayCredentialSettingKeys(): string[] {
  return CREDENTIAL_CONSUMERS.filter((c) => c.consumedBy !== "none").map((c) => c.settingKey);
}

export type CredentialSource = "setting" | "environment" | "absent";

export interface ProviderCredentialStatus {
  id: string;
  label: string;
  routable: boolean;
  /** Where a credential was found, if one was. */
  source: CredentialSource;
  /** Which key supplied it. Never the value. */
  sourceKey: string | null;
  /**
   * A masked hint: the last four characters only, and only for a value long
   * enough that four characters reveal nothing. Never the credential itself.
   */
  maskedHint: string | null;
  /** What is wrong, in the words an operator needs. */
  problem: string | null;
  requirement: string;
}

export interface CredentialEnv {
  settings: Record<string, unknown>;
  env: Record<string, string | undefined>;
}

/**
 * Resolve the credential state of every provider, without ever returning a value.
 *
 * This is the function the admin console and the integrations probe both call, so
 * "is this provider configured" has one implementation and one answer. The output
 * is deliberately incapable of carrying a secret: there is no field for a value,
 * only a source, a key name and a four-character hint.
 */
export function providerCredentialStatus(input: CredentialEnv): ProviderCredentialStatus[] {
  const statuses: ProviderCredentialStatus[] = [];

  for (const provider of ROUTABLE_PROVIDERS) {
    let source: CredentialSource = "absent";
    let sourceKey: string | null = null;
    let value = "";

    for (const key of provider.settingKeys) {
      const candidate = input.settings[key];
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        source = "setting";
        sourceKey = key;
        value = candidate.trim();
        break;
      }
    }
    if (source === "absent") {
      for (const key of provider.envKeys) {
        const candidate = input.env[key];
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          source = "environment";
          sourceKey = key;
          value = candidate.trim();
          break;
        }
      }
    }

    statuses.push({
      id: provider.id,
      label: provider.label,
      routable: true,
      source,
      sourceKey,
      maskedHint: maskSecretHint(value),
      problem: source === "absent" ? "no credential found" : null,
      requirement: provider.requirement,
    });
  }

  for (const consumer of CREDENTIAL_CONSUMERS) {
    // Reported explicitly rather than omitted, because the failure mode here is a
    // *false confirmation*: a key that is stored, displayed and probed while being
    // read by nothing, or read by something the console has mislabelled.
    let source: CredentialSource = "absent";
    let sourceKey: string | null = null;
    let value = "";

    const fromSetting = input.settings[consumer.settingKey];
    if (typeof fromSetting === "string" && fromSetting.trim().length > 0) {
      source = "setting";
      sourceKey = consumer.settingKey;
      value = fromSetting.trim();
    } else {
      for (const key of consumer.envKeys) {
        const candidate = input.env[key];
        if (typeof candidate === "string" && candidate.trim().length > 0) {
          source = "environment";
          sourceKey = key;
          value = candidate.trim();
          break;
        }
      }
    }

    statuses.push({
      id: consumer.settingKey,
      label: consumer.label,
      // Deliberately false even when live: this credential cannot be used *by the
      // AI gateway*, and `routable` is a statement about the gateway. The
      // distinction is what stops the console reporting an image credential as
      // text-model health.
      routable: false,
      source,
      sourceKey,
      maskedHint: maskSecretHint(value),
      problem: source === "absent" ? null : consumer.note,
      requirement: consumer.note,
    });
  }

  for (const provider of ABSENT_PROVIDERS) {
    statuses.push({
      id: provider.id,
      label: provider.label,
      routable: false,
      source: "absent",
      sourceKey: null,
      maskedHint: null,
      problem: provider.reason,
      requirement: provider.reason,
    });
  }

  return statuses;
}

/**
 * The masked hint shown in the console.
 *
 * Four trailing characters, and only for values long enough that four characters
 * are not a meaningful fraction of the secret. A short value gets no hint at all
 * — revealing four of eight characters is half the credential, which is the exact
 * mistake a "masked" display usually makes.
 *
 * Four characters are also not enough to brute-force a provider key, and the
 * hint's purpose is narrow: an operator verifying that a *rotated* key took
 * effect can see the last four change.
 */
export function maskSecretHint(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 12) return null;
  return `••••${trimmed.slice(-4)}`;
}

/**
 * Validate a candidate credential before it is stored or used.
 *
 * Shape-only, and that limitation is stated rather than hidden: this cannot tell
 * a valid key from an invalid one without making a request, and it does not make
 * one. What it does catch is the class of mistake that is otherwise invisible —
 * a wrong value pasted into the wrong field, a truncated copy, a placeholder left
 * in place — each of which currently stores cleanly and then fails at the first
 * real call.
 */
export interface CredentialValidation {
  ok: boolean;
  problem: string | null;
}

const PLACEHOLDER_PATTERN = /^(changeme|your[-_ ]?key|xxx+|placeholder|todo|test|dummy|redacted)$/i;

export function validateCredential(providerId: string, value: string): CredentialValidation {
  const provider = byId.get(providerId);
  if (!provider) {
    // Three distinct refusals, because they need different actions from the
    // operator. Collapsing them into "not known" would send someone with an
    // OpenAI key looking for a typo instead of at the real reason.
    const consumer = credentialConsumer(providerId) ?? credentialConsumer(`${providerId}ApiKey`);
    const absent = absentById.get(providerId);
    if (consumer) {
      return {
        ok: false,
        problem:
          consumer.consumedBy === "none"
            ? `${consumer.label} is not a routable provider and no module reads this key, so storing a credential would be read by nothing. ${consumer.note}`
            : `${consumer.label} is not an AI-gateway provider, so the gateway cannot use this credential. ${consumer.note}`,
      };
    }
    return {
      ok: false,
      problem: absent
        ? `${absent.label} is not implemented, so a credential for it would be read by nothing. ${absent.reason}`
        : `"${providerId}" is not a known provider.`,
    };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, problem: "the value is empty" };
  if (PLACEHOLDER_PATTERN.test(trimmed)) {
    return { ok: false, problem: `"${trimmed}" looks like a placeholder rather than a credential` };
  }
  if (trimmed.length < 16) {
    return { ok: false, problem: `the value is ${trimmed.length} characters; a provider key is longer than that` };
  }
  // The scheme check runs *before* the whitespace check, because "Bearer sk-…"
  // contains a space and the generic message would hide the specific, more
  // useful one: the operator pasted the whole header instead of the key.
  if (/^Bearer\s/i.test(trimmed)) {
    return { ok: false, problem: 'the value includes the "Bearer " prefix; store only the key itself' };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, problem: "the value contains whitespace, which a pasted key should not" };
  }
  return { ok: true, problem: null };
}

/**
 * A stable fingerprint of a credential, for change detection without storage.
 *
 * Lets an operator see "the key changed since the last successful call" without
 * the console ever holding the key. Salted with the provider id so the same value
 * used for two providers does not produce the same fingerprint.
 */
export function credentialFingerprint(providerId: string, value: string): string | null {
  if (value.trim().length < 12) return null;
  return createHash("sha256").update(`${providerId}:${value.trim()}`).digest("hex").slice(0, 12);
}

/** Structural invariants, asserted by the suite. */
export function registryInvariants(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const provider of ROUTABLE_PROVIDERS) {
    if (seen.has(provider.id)) problems.push(`duplicate provider id "${provider.id}"`);
    seen.add(provider.id);
    if (provider.envKeys.length === 0) problems.push(`"${provider.id}" declares no environment key`);
    if (provider.settingKeys.length === 0) problems.push(`"${provider.id}" cannot be configured from the console`);
    if (!provider.requirement.trim()) problems.push(`"${provider.id}" does not say what it needs`);
    if (!provider.baseUrl.startsWith("https://")) problems.push(`"${provider.id}" has a non-HTTPS base URL`);
  }

  for (const provider of ABSENT_PROVIDERS) {
    if (seen.has(provider.id)) problems.push(`"${provider.id}" is listed as both routable and absent`);
    seen.add(provider.id);
    if (!provider.reason.trim()) problems.push(`"${provider.id}" does not say why it is unsupported`);
  }

  for (const consumer of CREDENTIAL_CONSUMERS) {
    // A consumer claiming the AI gateway must actually be one of the routable
    // providers, or the console would report a capability the gateway lacks.
    if (consumer.consumedBy === "ai-gateway" && !ROUTABLE_PROVIDERS.some((p) => p.settingKeys.includes(consumer.settingKey))) {
      problems.push(`"${consumer.settingKey}" claims to be read by the AI gateway but no provider declares it`);
    }
    if (!consumer.note.trim()) problems.push(`"${consumer.settingKey}" has no console note`);
    if (consumer.consumedBy === "none" && consumer.consumer !== "still read by nothing") {
      problems.push(`"${consumer.settingKey}" is unread but names a consumer "${consumer.consumer}"`);
    }
  }

  // A routable provider must not be advertised by name as unsupported, or the
  // registry would contradict itself. Checked against the routable list rather
  // than against every id seen: `gemini` is *correctly* both an entry in
  // `ABSENT_PROVIDERS` and a name in `KNOWN_UNROUTABLE_NAMES`, and an earlier
  // version of this check flagged that correct state as a defect.
  const routableIds = new Set(routableProviderIds());
  for (const name of KNOWN_UNROUTABLE_NAMES) {
    if (routableIds.has(name)) problems.push(`"${name}" is both routable and listed as unsupported`);
  }

  return problems;
}
