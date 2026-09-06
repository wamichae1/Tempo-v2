import { beforeEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  discoverModels: vi.fn(),
}));

vi.mock("@/features/agent/ai/provider-registry", () => ({
  createAiProvider: () => ({
    discoverModels: providerMocks.discoverModels,
  }),
}));

import {
  cacheModels,
  discoverAndCacheModels,
  getCachedModels,
  invalidateModelCache,
  searchModels,
} from "@/features/agent/ai/model-catalog";

const models = [
  {
    id: "vendor/flash",
    providerId: "openrouter" as const,
    displayName: "Flash Model",
    owner: "Vendor",
    toolSupport: "supported" as const,
  },
  {
    id: "vendor/pro",
    providerId: "openrouter" as const,
    displayName: "Pro Model",
    toolSupport: "unknown" as const,
  },
];

describe("model catalog", () => {
  beforeEach(() => invalidateModelCache());

  it("caches by provider and in-memory key revision", () => {
    cacheModels("openrouter", 2, models, 1_000);
    expect(getCachedModels("openrouter", 2, 1_001)).toEqual(models);
    expect(getCachedModels("openrouter", 3, 1_001)).toBeNull();
    expect(getCachedModels("openrouter", 2, 400_001)).toBeNull();
  });

  it("searches display names, ids, and owners case-insensitively", () => {
    expect(searchModels(models, "flash")).toHaveLength(1);
    expect(searchModels(models, "VENDOR")).toHaveLength(2);
    expect(searchModels(models, "pro")).toEqual([models[1]]);
  });

  it("reuses models cached during key validation", async () => {
    providerMocks.discoverModels.mockResolvedValue(models);
    const signal = new AbortController().signal;
    await expect(
      discoverAndCacheModels({
        provider: "openrouter",
        apiKey: "validation-only-secret",
        revision: 4,
        signal,
        force: true,
      }),
    ).resolves.toEqual(models);
    await expect(
      discoverAndCacheModels({
        provider: "openrouter",
        apiKey: "validation-only-secret",
        revision: 4,
        signal,
      }),
    ).resolves.toEqual(models);
    expect(providerMocks.discoverModels).toHaveBeenCalledOnce();
    expect(JSON.stringify(models)).not.toContain("validation-only-secret");
  });
});
