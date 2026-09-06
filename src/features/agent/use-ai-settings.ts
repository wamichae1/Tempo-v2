import { useCallback, useEffect, useMemo, useState } from "react";

import type { RunnableAiProviderId } from "@/features/agent/ai/ai-provider";
import {
  AI_SETTINGS_V1_STORAGE_KEY,
  AI_SETTINGS_V2_STORAGE_KEY,
  loadAiSettings,
  serializeAiSettings,
  type ProviderModels,
} from "@/features/agent/ai/ai-settings-storage";
import {
  clearAllPersistedApiKeys,
  EMPTY_API_KEY_STATES,
  getApiKeyStorageKey,
  loadPersistedApiKeys,
  persistApiKey,
  type ApiKeyState,
  type ApiKeyStates,
} from "@/features/agent/ai/api-key-store";
import { invalidateModelCache } from "@/features/agent/ai/model-catalog";
import { getAiProviderDefinition } from "@/features/agent/ai/provider-registry";

interface InitialAiState {
  provider: RunnableAiProviderId;
  models: ProviderModels;
  keys: ApiKeyStates;
}

const unavailableStorage: Storage = {
  length: 0,
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {},
};

function readInitialState(): InitialAiState {
  try {
    const loaded = loadAiSettings(localStorage);
    const keys = loadPersistedApiKeys(localStorage);
    if (loaded.migratedFromV1 && !loaded.legacyRememberOpenAi) {
      localStorage.removeItem(getApiKeyStorageKey("openai"));
      keys.openai = { ...EMPTY_API_KEY_STATES.openai };
    }
    return {
      provider: loaded.settings.provider,
      models: loaded.settings.models,
      keys,
    };
  } catch {
    const loaded = loadAiSettings(unavailableStorage);
    return {
      provider: loaded.settings.provider,
      models: loaded.settings.models,
      keys: structuredClone(EMPTY_API_KEY_STATES),
    };
  }
}

export interface AiSettingsState {
  provider: RunnableAiProviderId;
  setProvider: (provider: RunnableAiProviderId) => void;
  model: string;
  setModel: (model: string) => void;
  models: ProviderModels;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  rememberApiKey: boolean;
  setRememberApiKey: (remember: boolean) => void;
  keyStates: ApiKeyStates;
  getKeyState: (provider: RunnableAiProviderId) => ApiKeyState;
  saveApiKey: (
    provider: RunnableAiProviderId,
    apiKey: string,
    remember: boolean,
  ) => void;
  clearApiKey: (provider?: RunnableAiProviderId) => void;
  clearAllApiKeys: () => void;
  configured: boolean;
  configuredKeys: string[];
}

export function useAiSettings(): AiSettingsState {
  const [initial] = useState(readInitialState);
  const [provider, setProvider] = useState(initial.provider);
  const [models, setModels] = useState(initial.models);
  const [keyStates, setKeyStates] = useState(initial.keys);

  useEffect(() => {
    try {
      localStorage.setItem(
        AI_SETTINGS_V2_STORAGE_KEY,
        serializeAiSettings({ version: 2, provider, models }),
      );
      localStorage.removeItem(AI_SETTINGS_V1_STORAGE_KEY);
    } catch {
      // Keep non-secret settings in memory when storage is unavailable.
    }
  }, [models, provider]);

  const setModel = useCallback(
    (model: string) => {
      setModels((current) => ({ ...current, [provider]: model }));
    },
    [provider],
  );

  const saveApiKey = useCallback(
    (
      targetProvider: RunnableAiProviderId,
      apiKey: string,
      remember: boolean,
    ) => {
      const definition = getAiProviderDefinition(targetProvider);
      const normalized =
        definition.create?.().normalizeApiKey(apiKey) ?? apiKey.trim();
      try {
        persistApiKey(localStorage, targetProvider, normalized, remember);
      } catch {
        remember = false;
      }
      invalidateModelCache(targetProvider);
      setKeyStates((current) => ({
        ...current,
        [targetProvider]: {
          value: normalized,
          persisted: remember && normalized.length > 0,
          revision: current[targetProvider].revision + 1,
        },
      }));
    },
    [],
  );

  const setApiKey = useCallback(
    (apiKey: string) => {
      saveApiKey(provider, apiKey, false);
    },
    [provider, saveApiKey],
  );

  const setRememberApiKey = useCallback(
    (remember: boolean) => {
      saveApiKey(provider, keyStates[provider].value, remember);
    },
    [keyStates, provider, saveApiKey],
  );

  const clearApiKey = useCallback(
    (targetProvider: RunnableAiProviderId = provider) => {
      try {
        persistApiKey(localStorage, targetProvider, "", false);
      } catch {
        // The in-memory key is still cleared.
      }
      invalidateModelCache(targetProvider);
      setKeyStates((current) => ({
        ...current,
        [targetProvider]: {
          value: "",
          persisted: false,
          revision: current[targetProvider].revision + 1,
        },
      }));
    },
    [provider],
  );

  const clearAllApiKeys = useCallback(() => {
    try {
      clearAllPersistedApiKeys(localStorage);
    } catch {
      // The in-memory keys are still cleared.
    }
    invalidateModelCache();
    setKeyStates((current) =>
      Object.fromEntries(
        (Object.keys(current) as RunnableAiProviderId[]).map((id) => [
          id,
          {
            value: "",
            persisted: false,
            revision: current[id].revision + 1,
          },
        ]),
      ) as ApiKeyStates,
    );
  }, []);

  const getKeyState = useCallback(
    (targetProvider: RunnableAiProviderId) => keyStates[targetProvider],
    [keyStates],
  );

  const configuredKeys = useMemo(
    () =>
      Object.values(keyStates)
        .map((state) => state.value.trim())
        .filter(Boolean),
    [keyStates],
  );
  const currentKey = keyStates[provider];
  const model = models[provider];

  return {
    provider,
    setProvider,
    model,
    setModel,
    models,
    apiKey: currentKey.value,
    setApiKey,
    rememberApiKey: currentKey.persisted,
    setRememberApiKey,
    keyStates,
    getKeyState,
    saveApiKey,
    clearApiKey,
    clearAllApiKeys,
    configured: currentKey.value.trim().length > 0 && model.trim().length > 0,
    configuredKeys,
  };
}
