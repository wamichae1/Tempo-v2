import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import {
  classifyApiKeyValidationFailure,
  type ApiKeySaveResult,
  validateAndPersistApiKey,
  validateApiKeyCandidate,
} from "@/features/agent/ai/api-key-validation";
import { invalidateModelCache } from "@/features/agent/ai/model-catalog";

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
  rememberApiKey: boolean;
  keyStates: ApiKeyStates;
  getKeyState: (provider: RunnableAiProviderId) => ApiKeyState;
  saveApiKey: (
    provider: RunnableAiProviderId,
    apiKey: string,
    remember: boolean,
  ) => Promise<ApiKeySaveResult>;
  retryApiKeyValidation: (
    provider: RunnableAiProviderId,
  ) => Promise<ApiKeySaveResult>;
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
  const keyStatesRef = useRef(initial.keys);
  const validationControllers = useRef(
    new Map<RunnableAiProviderId, AbortController>(),
  );

  const updateKeyStates = useCallback(
    (
      update:
        | ApiKeyStates
        | ((current: ApiKeyStates) => ApiKeyStates),
    ) => {
      setKeyStates((current) => {
        const next =
          typeof update === "function" ? update(current) : update;
        keyStatesRef.current = next;
        return next;
      });
    },
    [],
  );

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

  const validateStoredKey = useCallback(
    async (
      targetProvider: RunnableAiProviderId,
      expected: ApiKeyState,
    ): Promise<ApiKeySaveResult> => {
      validationControllers.current.get(targetProvider)?.abort();
      const controller = new AbortController();
      validationControllers.current.set(targetProvider, controller);
      try {
        await validateApiKeyCandidate({
          provider: targetProvider,
          apiKey: expected.value,
          revision: expected.revision,
          signal: controller.signal,
          force: true,
        });
        const current = keyStatesRef.current[targetProvider];
        if (
          controller.signal.aborted ||
          current.revision !== expected.revision ||
          current.value !== expected.value
        ) {
          return { ok: false, cancelled: true };
        }
        const state: ApiKeyState = {
          ...current,
          status: "verified",
          error: "",
        };
        updateKeyStates((keys) => ({ ...keys, [targetProvider]: state }));
        return { ok: true, state };
      } catch (error) {
        if (controller.signal.aborted) {
          return { ok: false, cancelled: true };
        }
        const current = keyStatesRef.current[targetProvider];
        if (
          current.revision !== expected.revision ||
          current.value !== expected.value
        ) {
          return { ok: false, cancelled: true };
        }
        const failure = classifyApiKeyValidationFailure(error);
        updateKeyStates((keys) => ({
          ...keys,
          [targetProvider]: {
            ...current,
            status: failure.status,
            error: failure.message,
          },
        }));
        return { ok: false, ...failure };
      } finally {
        if (validationControllers.current.get(targetProvider) === controller) {
          validationControllers.current.delete(targetProvider);
        }
      }
    },
    [updateKeyStates],
  );

  useEffect(() => {
    const controllers: AbortController[] = [];
    for (const targetProvider of Object.keys(
      initial.keys,
    ) as RunnableAiProviderId[]) {
      const state = initial.keys[targetProvider];
      if (!state.value || state.status !== "validating") continue;
      void validateStoredKey(targetProvider, state);
      const controller = validationControllers.current.get(targetProvider);
      if (controller) controllers.push(controller);
    }
    return () => {
      for (const controller of controllers) controller.abort();
    };
  }, [initial.keys, validateStoredKey]);

  useEffect(
    () => () => {
      for (const controller of validationControllers.current.values()) {
        controller.abort();
      }
      validationControllers.current.clear();
    },
    [],
  );

  const saveApiKey = useCallback(
    (
      targetProvider: RunnableAiProviderId,
      apiKey: string,
      remember: boolean,
    ): Promise<ApiKeySaveResult> => {
      validationControllers.current.get(targetProvider)?.abort();
      const controller = new AbortController();
      validationControllers.current.set(targetProvider, controller);
      const previous = keyStatesRef.current[targetProvider];
      const revision = previous.revision + 1;
      let storage = unavailableStorage;
      try {
        storage = localStorage;
      } catch {
        // A valid key will remain memory-only when browser storage is unavailable.
      }
      return validateAndPersistApiKey({
        provider: targetProvider,
        apiKey,
        remember: storage === unavailableStorage ? false : remember,
        revision,
        storage,
        signal: controller.signal,
        canCommit: () => {
          const current = keyStatesRef.current[targetProvider];
          return (
            current.revision === previous.revision &&
            current.value === previous.value
          );
        },
      }).then((result) => {
        if (result.ok) {
          updateKeyStates((current) => ({
            ...current,
            [targetProvider]: result.state,
          }));
        }
        if (validationControllers.current.get(targetProvider) === controller) {
          validationControllers.current.delete(targetProvider);
        }
        return result;
      });
    },
    [updateKeyStates],
  );

  const retryApiKeyValidation = useCallback(
    (targetProvider: RunnableAiProviderId) => {
      const current = keyStatesRef.current[targetProvider];
      if (!current.value) {
        return Promise.resolve({
          ok: false,
          status: "invalid",
          message: "Invalid API key. Enter a key and try again.",
        } satisfies ApiKeySaveResult);
      }
      updateKeyStates((keys) => ({
        ...keys,
        [targetProvider]: {
          ...keys[targetProvider],
          status: "validating",
          error: "",
        },
      }));
      return validateStoredKey(targetProvider, {
        ...current,
        status: "validating",
        error: "",
      });
    },
    [updateKeyStates, validateStoredKey],
  );

  const clearApiKey = useCallback(
    (targetProvider: RunnableAiProviderId = provider) => {
      validationControllers.current.get(targetProvider)?.abort();
      validationControllers.current.delete(targetProvider);
      try {
        persistApiKey(localStorage, targetProvider, "", false);
      } catch {
        // The in-memory key is still cleared.
      }
      invalidateModelCache(targetProvider);
      updateKeyStates((current) => ({
        ...current,
        [targetProvider]: {
          value: "",
          persisted: false,
          revision: current[targetProvider].revision + 1,
          status: "not-configured",
          error: "",
        },
      }));
    },
    [provider, updateKeyStates],
  );

  const clearAllApiKeys = useCallback(() => {
    for (const controller of validationControllers.current.values()) {
      controller.abort();
    }
    validationControllers.current.clear();
    try {
      clearAllPersistedApiKeys(localStorage);
    } catch {
      // The in-memory keys are still cleared.
    }
    invalidateModelCache();
    updateKeyStates((current) =>
      Object.fromEntries(
        (Object.keys(current) as RunnableAiProviderId[]).map((id) => [
          id,
          {
            value: "",
            persisted: false,
            revision: current[id].revision + 1,
            status: "not-configured",
            error: "",
          },
        ]),
      ) as ApiKeyStates,
    );
  }, [updateKeyStates]);

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
    rememberApiKey: currentKey.persisted,
    keyStates,
    getKeyState,
    saveApiKey,
    retryApiKeyValidation,
    clearApiKey,
    clearAllApiKeys,
    configured:
      currentKey.status === "verified" && model.trim().length > 0,
    configuredKeys,
  };
}
