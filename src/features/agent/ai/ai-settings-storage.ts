import type {
  RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";
import {
  getAiProviderDefinition,
  isRunnableAiProviderId,
  listAiProviderDefinitions,
} from "@/features/agent/ai/provider-registry";

export const AI_SETTINGS_V1_STORAGE_KEY = "tempo:ai-settings:v1";
export const AI_SETTINGS_V2_STORAGE_KEY = "tempo:ai-settings:v2";

export type ProviderModels = Record<RunnableAiProviderId, string>;

export interface StoredAiSettingsV2 {
  version: 2;
  provider: RunnableAiProviderId;
  models: ProviderModels;
}

interface StoredAiSettingsV1 {
  version: 1;
  provider: "openai";
  model: string;
  rememberApiKey: boolean;
}

export interface LoadedAiSettings {
  settings: StoredAiSettingsV2;
  migratedFromV1: boolean;
  legacyRememberOpenAi: boolean;
}

export function defaultProviderModels(): ProviderModels {
  return Object.fromEntries(
    listAiProviderDefinitions()
      .filter((definition) => definition.create)
      .map((definition) => [
        definition.metadata.id,
        definition.metadata.defaultModelId,
      ]),
  ) as ProviderModels;
}

export function defaultAiSettings(): StoredAiSettingsV2 {
  return {
    version: 2,
    provider: "openai",
    models: defaultProviderModels(),
  };
}

function parseV2(raw: string | null): StoredAiSettingsV2 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAiSettingsV2>;
    if (
      parsed.version !== 2 ||
      !isRunnableAiProviderId(parsed.provider) ||
      getAiProviderDefinition(parsed.provider).metadata.availability !==
        "enabled" ||
      typeof parsed.models !== "object" ||
      parsed.models === null
    ) {
      return null;
    }
    const models = defaultProviderModels();
    for (const provider of Object.keys(models) as RunnableAiProviderId[]) {
      const value = (parsed.models as Partial<ProviderModels>)[provider];
      if (typeof value === "string" && value.trim()) models[provider] = value.trim();
    }
    return { version: 2, provider: parsed.provider, models };
  } catch {
    return null;
  }
}

function parseV1(raw: string | null): StoredAiSettingsV1 | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAiSettingsV1>;
    if (
      parsed.version !== 1 ||
      parsed.provider !== "openai" ||
      typeof parsed.model !== "string" ||
      !parsed.model.trim()
    ) {
      return null;
    }
    return {
      version: 1,
      provider: "openai",
      model: parsed.model.trim(),
      rememberApiKey: parsed.rememberApiKey === true,
    };
  } catch {
    return null;
  }
}

export function loadAiSettings(storage: Storage): LoadedAiSettings {
  const current = parseV2(storage.getItem(AI_SETTINGS_V2_STORAGE_KEY));
  if (current) {
    return {
      settings: current,
      migratedFromV1: false,
      legacyRememberOpenAi: false,
    };
  }
  const legacy = parseV1(storage.getItem(AI_SETTINGS_V1_STORAGE_KEY));
  if (!legacy) {
    return {
      settings: defaultAiSettings(),
      migratedFromV1: false,
      legacyRememberOpenAi: false,
    };
  }
  const settings = defaultAiSettings();
  settings.models.openai = legacy.model;
  return {
    settings,
    migratedFromV1: true,
    legacyRememberOpenAi: legacy.rememberApiKey,
  };
}

export function serializeAiSettings(settings: StoredAiSettingsV2): string {
  const clean = defaultAiSettings();
  clean.provider = settings.provider;
  for (const provider of Object.keys(clean.models) as RunnableAiProviderId[]) {
    clean.models[provider] =
      settings.models[provider].trim() ||
      getAiProviderDefinition(provider).metadata.defaultModelId;
  }
  return JSON.stringify(clean);
}
