import { describe, expect, it, vi } from "vitest";

import { AiProviderError } from "@/features/agent/ai/ai-provider";
import {
  validateAndPersistApiKey,
} from "@/features/agent/ai/api-key-validation";
import {
  clearAllPersistedApiKeys,
  getApiKeyStorageKey,
  loadPersistedApiKeys,
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

const discoveredModels = [{
  id: "test-model",
  providerId: "openai" as const,
  displayName: "Test model",
  toolSupport: "unknown" as const,
}];

describe("API key validation and persistence", () => {
  it("does not verify or persist arbitrary non-empty rejected text", async () => {
    const storage = new MemoryStorage();
    const result = await validateAndPersistApiKey({
      provider: "openai",
      apiKey: "arbitrary-non-empty-text",
      remember: true,
      revision: 1,
      storage,
      signal: new AbortController().signal,
      canCommit: () => true,
      discover: vi.fn().mockRejectedValue(
        new AiProviderError("authentication", "Rejected."),
      ),
    });

    expect(result).toMatchObject({ ok: false, status: "invalid" });
    expect(storage.getItem(getApiKeyStorageKey("openai"))).toBeNull();
    expect(JSON.stringify(result)).not.toContain("arbitrary-non-empty-text");
  });

  it("reports provider failures without persisting or exposing the candidate", async () => {
    const storage = new MemoryStorage();
    const result = await validateAndPersistApiKey({
      provider: "gemini",
      apiKey: "provider-error-candidate",
      remember: true,
      revision: 1,
      storage,
      signal: new AbortController().signal,
      canCommit: () => true,
      discover: vi.fn().mockRejectedValue(
        new AiProviderError("network", "Sensitive upstream detail", true),
      ),
    });

    expect(result).toMatchObject({ ok: false, status: "error" });
    expect(storage.getItem(getApiKeyStorageKey("gemini"))).toBeNull();
    expect(JSON.stringify(result)).not.toContain("provider-error-candidate");
    expect(JSON.stringify(result)).not.toContain("Sensitive upstream detail");
  });

  it("keeps a successfully validated key memory-only when remember is off", async () => {
    const storage = new MemoryStorage();
    const result = await validateAndPersistApiKey({
      provider: "openai",
      apiKey: " valid-memory-key ",
      remember: false,
      revision: 2,
      storage,
      signal: new AbortController().signal,
      canCommit: () => true,
      discover: vi.fn().mockResolvedValue(discoveredModels),
    });

    expect(result).toMatchObject({
      ok: true,
      state: {
        value: "valid-memory-key",
        persisted: false,
        status: "verified",
      },
    });
    expect(storage.getItem(getApiKeyStorageKey("openai"))).toBeNull();
  });

  it("persists a remembered key only after successful validation", async () => {
    const storage = new MemoryStorage();
    const discover = vi.fn().mockResolvedValue(discoveredModels);
    const result = await validateAndPersistApiKey({
      provider: "openai",
      apiKey: "valid-remembered-key",
      remember: true,
      revision: 3,
      storage,
      signal: new AbortController().signal,
      canCommit: () => true,
      discover,
    });

    expect(discover).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      ok: true,
      state: { persisted: true, status: "verified" },
    });
    expect(storage.getItem(getApiKeyStorageKey("openai"))).toBe(
      "valid-remembered-key",
    );
    expect(loadPersistedApiKeys(storage).openai.status).toBe("validating");
  });

  it("does not overwrite an existing key when a replacement cannot commit", async () => {
    const storage = new MemoryStorage();
    persistApiKey(storage, "openai", "existing-key", true);
    const result = await validateAndPersistApiKey({
      provider: "openai",
      apiKey: "replacement-key",
      remember: true,
      revision: 4,
      storage,
      signal: new AbortController().signal,
      canCommit: () => false,
      discover: vi.fn().mockResolvedValue(discoveredModels),
    });

    expect(result).toEqual({ ok: false, cancelled: true });
    expect(storage.getItem(getApiKeyStorageKey("openai"))).toBe("existing-key");
  });

  it("preserves individual and clear-all storage behavior", () => {
    const storage = new MemoryStorage();
    persistApiKey(storage, "openai", "openai-key", true);
    persistApiKey(storage, "gemini", "gemini-key", true);
    persistApiKey(storage, "openai", "", false);
    expect(storage.getItem(getApiKeyStorageKey("openai"))).toBeNull();
    expect(storage.getItem(getApiKeyStorageKey("gemini"))).toBe("gemini-key");

    clearAllPersistedApiKeys(storage);
    expect(storage.length).toBe(0);
  });
});
