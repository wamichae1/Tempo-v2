import { describe, expect, it } from "vitest";

import {
  AI_SETTINGS_V1_STORAGE_KEY,
  AI_SETTINGS_V2_STORAGE_KEY,
  loadAiSettings,
  serializeAiSettings,
} from "@/features/agent/ai/ai-settings-storage";
import {
  clearAllPersistedApiKeys,
  getApiKeyStorageKey,
  loadPersistedApiKeys,
  maskApiKey,
  persistApiKey,
} from "@/features/agent/ai/api-key-store";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("AI settings and API key storage", () => {
  it("migrates v1 settings without placing keys in v2 settings", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      AI_SETTINGS_V1_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        provider: "openai",
        model: "custom-openai-model",
        rememberApiKey: true,
      }),
    );
    storage.setItem(getApiKeyStorageKey("openai"), "sk-test-secret");

    const loaded = loadAiSettings(storage);
    expect(loaded.migratedFromV1).toBe(true);
    expect(loaded.legacyRememberOpenAi).toBe(true);
    expect(loaded.settings.models.openai).toBe("custom-openai-model");

    const serialized = serializeAiSettings(loaded.settings);
    storage.setItem(AI_SETTINGS_V2_STORAGE_KEY, serialized);
    expect(serialized).not.toContain("sk-test-secret");
    expect(serialized).not.toContain("rememberApiKey");
  });

  it("keeps provider keys separate and memory-only unless remembered", () => {
    const storage = new MemoryStorage();
    persistApiKey(storage, "openai", "sk-openai", false);
    expect(storage.getItem(getApiKeyStorageKey("openai"))).toBeNull();

    persistApiKey(storage, "openrouter", "sk-or-test", true);
    persistApiKey(storage, "opencode", "sk-opencode-test", true);
    persistApiKey(storage, "gemini", "gemini-test", true);
    const loaded = loadPersistedApiKeys(storage);
    expect(loaded.openrouter).toMatchObject({
      value: "sk-or-test",
      persisted: true,
    });
    expect(loaded.opencode.value).toBe("");
    expect(storage.getItem(getApiKeyStorageKey("opencode"))).toBe(
      "sk-opencode-test",
    );
    expect(loaded.gemini.value).toBe("gemini-test");
    expect(loaded.openai.value).toBe("");
  });

  it("clears every provider key including the deferred NVIDIA key", () => {
    const storage = new MemoryStorage();
    for (const provider of [
      "openai",
      "openrouter",
      "opencode",
      "gemini",
      "nvidia-nim",
    ] as const) {
      storage.setItem(getApiKeyStorageKey(provider), `secret-${provider}`);
    }
    clearAllPersistedApiKeys(storage);
    expect(storage.length).toBe(0);
  });

  it("falls back from a deferred OpenCode selection without deleting its key", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      AI_SETTINGS_V2_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        provider: "opencode",
        models: {
          openai: "gpt-test",
          openrouter: "openrouter-test",
          opencode: "gpt-5.4-mini",
          gemini: "gemini-3.7-flash",
        },
      }),
    );
    persistApiKey(storage, "opencode", "saved-opencode-key", true);

    expect(loadAiSettings(storage).settings.provider).toBe("openai");
    expect(storage.getItem(getApiKeyStorageKey("opencode"))).toBe(
      "saved-opencode-key",
    );
  });

  it("masks API keys by default while retaining only the final four characters", () => {
    const masked = maskApiKey("sk-provider-secret-1234");
    expect(masked).toBe("••••••••1234");
    expect(masked).not.toContain("provider-secret");
  });
});
