import type {
  AIModel,
  RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";

const MODEL_CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry {
  revision: number;
  expiresAt: number;
  models: AIModel[];
}

const cache = new Map<RunnableAiProviderId, CacheEntry>();

export function getCachedModels(
  provider: RunnableAiProviderId,
  revision: number,
  now = Date.now(),
): AIModel[] | null {
  const entry = cache.get(provider);
  if (!entry || entry.revision !== revision || entry.expiresAt <= now) return null;
  return entry.models;
}

export function cacheModels(
  provider: RunnableAiProviderId,
  revision: number,
  models: AIModel[],
  now = Date.now(),
): void {
  cache.set(provider, {
    revision,
    expiresAt: now + MODEL_CACHE_TTL_MS,
    models,
  });
}

export function invalidateModelCache(provider?: RunnableAiProviderId): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

export function searchModels(models: AIModel[], query: string): AIModel[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return models;
  return models.filter((model) =>
    [model.displayName, model.id, model.owner]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLowerCase().includes(normalized)),
  );
}
