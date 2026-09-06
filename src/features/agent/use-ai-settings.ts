import { useCallback, useEffect, useState } from "react";

import type { AiProviderId } from "@/features/agent/ai/ai-provider";

const SETTINGS_STORAGE_KEY = "tempo:ai-settings:v1";
const OPENAI_KEY_STORAGE_KEY = "tempo:ai-key:openai:v1";
const DEFAULT_MODEL = "gpt-5-mini";

interface StoredAiSettings {
  version: 1;
  provider: AiProviderId;
  model: string;
  rememberApiKey: boolean;
}

function readStoredSettings(): StoredAiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredAiSettings>;
      if (
        parsed.version === 1 &&
        parsed.provider === "openai" &&
        typeof parsed.model === "string" &&
        parsed.model.trim()
      ) {
        return {
          version: 1,
          provider: "openai",
          model: parsed.model,
          rememberApiKey: parsed.rememberApiKey === true,
        };
      }
    }
  } catch {
    // Fall through to defaults.
  }
  return {
    version: 1,
    provider: "openai",
    model: DEFAULT_MODEL,
    rememberApiKey: false,
  };
}

function readStoredKey(remember: boolean): string {
  if (!remember) return "";
  try {
    return localStorage.getItem(OPENAI_KEY_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export interface AiSettingsState {
  provider: AiProviderId;
  setProvider: (provider: AiProviderId) => void;
  model: string;
  setModel: (model: string) => void;
  apiKey: string;
  setApiKey: (apiKey: string) => void;
  rememberApiKey: boolean;
  setRememberApiKey: (remember: boolean) => void;
  clearApiKey: () => void;
  configured: boolean;
}

export function useAiSettings(): AiSettingsState {
  const [initial] = useState(readStoredSettings);
  const [provider, setProvider] = useState<AiProviderId>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [rememberApiKey, setRememberState] = useState(initial.rememberApiKey);
  const [apiKey, setApiKeyState] = useState(() =>
    readStoredKey(initial.rememberApiKey),
  );

  useEffect(() => {
    try {
      const stored: StoredAiSettings = {
        version: 1,
        provider,
        model: model.trim() || DEFAULT_MODEL,
        rememberApiKey,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    } catch {
      // Keep preferences in memory when storage is unavailable.
    }
  }, [provider, model, rememberApiKey]);

  useEffect(() => {
    try {
      if (rememberApiKey && apiKey.trim()) {
        localStorage.setItem(OPENAI_KEY_STORAGE_KEY, apiKey.trim());
      } else {
        localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
      }
    } catch {
      // Keep the key in memory when storage is unavailable.
    }
  }, [apiKey, rememberApiKey]);

  const setApiKey = useCallback((value: string) => {
    setApiKeyState(value);
  }, []);

  const setRememberApiKey = useCallback((remember: boolean) => {
    setRememberState(remember);
  }, []);

  const clearApiKey = useCallback(() => {
    setApiKeyState("");
    try {
      localStorage.removeItem(OPENAI_KEY_STORAGE_KEY);
    } catch {
      // Nothing else to clear.
    }
  }, []);

  return {
    provider,
    setProvider,
    model,
    setModel,
    apiKey,
    setApiKey,
    rememberApiKey,
    setRememberApiKey,
    clearApiKey,
    configured: apiKey.trim().length > 0 && model.trim().length > 0,
  };
}
