import { describe, expect, it } from "vitest";

import {
  createAiProvider,
  getAiProviderDefinition,
  listAiProviderDefinitions,
  listRunnableAiProviders,
} from "@/features/agent/ai/provider-registry";

describe("AI provider registry", () => {
  it("registers four runnable providers and deferred NVIDIA metadata", () => {
    expect(listRunnableAiProviders().map((item) => item.metadata.id)).toEqual([
      "openai",
      "openrouter",
      "opencode",
      "gemini",
    ]);
    expect(listAiProviderDefinitions()).toHaveLength(5);
    expect(getAiProviderDefinition("nvidia-nim").metadata).toMatchObject({
      availability: "deferred",
      apiKeyStorageKey: "tempo:ai-key:nvidia-nim:v1",
    });
  });

  it("creates providers with matching metadata and key handling", () => {
    for (const id of ["openai", "openrouter", "opencode", "gemini"] as const) {
      const provider = createAiProvider(id);
      expect(provider.id).toBe(id);
      expect(provider.metadata.id).toBe(id);
      expect(provider.normalizeApiKey("  test-key  ")).toBe("test-key");
    }
  });
});
