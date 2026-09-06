import type {
  AiProviderId,
  RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";
import { listAiProviderDefinitions } from "@/features/agent/ai/provider-registry";

export interface ApiKeyState {
  value: string;
  persisted: boolean;
  revision: number;
  status: ApiKeyVerificationStatus;
  error: string;
}

export type ApiKeyVerificationStatus =
  | "not-configured"
  | "validating"
  | "verified"
  | "invalid"
  | "error";

export type ApiKeyStates = Record<RunnableAiProviderId, ApiKeyState>;

export const EMPTY_API_KEY_STATES: ApiKeyStates = {
  openai: {
    value: "",
    persisted: false,
    revision: 0,
    status: "not-configured",
    error: "",
  },
  openrouter: {
    value: "",
    persisted: false,
    revision: 0,
    status: "not-configured",
    error: "",
  },
  opencode: {
    value: "",
    persisted: false,
    revision: 0,
    status: "not-configured",
    error: "",
  },
  gemini: {
    value: "",
    persisted: false,
    revision: 0,
    status: "not-configured",
    error: "",
  },
};

export function getApiKeyStorageKey(provider: AiProviderId): string {
  const definition = listAiProviderDefinitions().find(
    (candidate) => candidate.metadata.id === provider,
  );
  if (!definition) throw new Error(`Unknown AI provider "${provider}".`);
  return definition.metadata.apiKeyStorageKey;
}

export function maskApiKey(value: string): string {
  if (value.length <= 4) return "••••••••";
  return `••••••••${value.slice(-4)}`;
}

export function loadPersistedApiKeys(storage: Storage): ApiKeyStates {
  const result: ApiKeyStates = structuredClone(EMPTY_API_KEY_STATES);
  for (const provider of Object.keys(result) as RunnableAiProviderId[]) {
    try {
      const definition = listAiProviderDefinitions().find(
        (candidate) => candidate.metadata.id === provider,
      );
      if (definition?.metadata.availability !== "enabled") continue;
      const value = storage.getItem(getApiKeyStorageKey(provider))?.trim() ?? "";
      if (value) {
        result[provider] = {
          value,
          persisted: true,
          revision: 1,
          status: "validating",
          error: "",
        };
      }
    } catch {
      // Keep this provider memory-only when storage is unavailable.
    }
  }
  return result;
}

export function persistApiKey(
  storage: Storage,
  provider: RunnableAiProviderId,
  value: string,
  remember: boolean,
): void {
  const key = getApiKeyStorageKey(provider);
  if (remember && value.trim()) {
    storage.setItem(key, value.trim());
  } else {
    storage.removeItem(key);
  }
}

export function clearAllPersistedApiKeys(storage: Storage): void {
  for (const definition of listAiProviderDefinitions()) {
    storage.removeItem(definition.metadata.apiKeyStorageKey);
  }
}
