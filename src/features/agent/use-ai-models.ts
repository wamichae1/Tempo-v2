import { useCallback, useEffect, useState } from "react";

import type {
  AIModel,
  RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";
import {
  discoverAndCacheModels,
  invalidateModelCache,
} from "@/features/agent/ai/model-catalog";

export type ModelCatalogStatus =
  | "idle"
  | "missing-key"
  | "loading"
  | "loaded"
  | "empty"
  | "error";

export interface AiModelsState {
  models: AIModel[];
  status: ModelCatalogStatus;
  error: string;
  refresh: () => void;
}

export function useAiModels({
  provider,
  apiKey,
  keyRevision,
  enabled,
}: {
  provider: RunnableAiProviderId;
  apiKey: string;
  keyRevision: number;
  enabled: boolean;
}): AiModelsState {
  const [models, setModels] = useState<AIModel[]>([]);
  const [status, setStatus] = useState<ModelCatalogStatus>("idle");
  const [error, setError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    if (!enabled) return;
    if (!apiKey.trim()) {
      queueMicrotask(() => {
        if (!active) return;
        setModels([]);
        setError("");
        setStatus("missing-key");
      });
      return () => {
        active = false;
      };
    }

    const controller = new AbortController();
    queueMicrotask(() => {
      if (!active || controller.signal.aborted) return;
      setModels([]);
      setError("");
      setStatus("loading");
    });
    void discoverAndCacheModels({
      provider,
      apiKey,
      revision: keyRevision,
      signal: controller.signal,
    })
      .then((discovered) => {
        if (controller.signal.aborted) return;
        setModels(discovered);
        setStatus(discovered.length > 0 ? "loaded" : "empty");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setModels([]);
        setError(
          reason instanceof Error
            ? reason.message
            : "The provider could not load its model catalog.",
        );
        setStatus("error");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiKey, enabled, keyRevision, provider, refreshVersion]);

  const refresh = useCallback(() => {
    invalidateModelCache(provider);
    setRefreshVersion((value) => value + 1);
  }, [provider]);

  return { models, status, error, refresh };
}
