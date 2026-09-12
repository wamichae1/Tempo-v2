import { describe, expect, it } from "vitest";

import {
  createAiProvider,
  getAiProviderDefinition,
  listAiProviderDefinitions,
  listRunnableAiProviders,
} from "@/features/agent/ai/provider-registry";

describe("AI provider registry", () => {
  it("registers browser-runnable providers and deferred provider metadata", () => {
    expect(listRunnableAiProviders().map((item) => item.metadata.id)).toEqual([
      "openai",
      "openrouter",
      "groq",
      "gemini",
    ]);
    expect(listAiProviderDefinitions()).toHaveLength(6);
    expect(getAiProviderDefinition("groq").metadata).toMatchObject({
      availability: "enabled",
      defaultModelId: "openai/gpt-oss-20b",
      apiKeyStorageKey: "tempo:ai-key:groq:v1",
    });
    expect(getAiProviderDefinition("opencode").metadata).toMatchObject({
      availability: "deferred",
      availabilityLabel: "Unavailable in browser",
    });
    expect(getAiProviderDefinition("nvidia-nim").metadata).toMatchObject({
      availability: "deferred",
      availabilityLabel: "Coming soon",
      apiKeyStorageKey: "tempo:ai-key:nvidia-nim:v1",
      unavailableReason: "NVIDIA NIM browser support is coming soon.",
    });
    expect(getAiProviderDefinition("nvidia-nim").create).toBeUndefined();
  });

  it("creates providers with matching metadata and key handling", () => {
    for (const id of [
      "openai",
      "openrouter",
      "groq",
      "opencode",
      "gemini",
    ] as const) {
      const provider = createAiProvider(id);
      expect(provider.id).toBe(id);
      expect(provider.metadata.id).toBe(id);
      expect(provider.normalizeApiKey("  test-key  ")).toBe("test-key");
    }
  });
});
