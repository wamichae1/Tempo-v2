import {
  AiProviderError,
  type RunnableAiProviderId,
} from "@/features/agent/ai/ai-provider";
import {
  persistApiKey,
  type ApiKeyState,
  type ApiKeyVerificationStatus,
} from "@/features/agent/ai/api-key-store";
import { discoverAndCacheModels } from "@/features/agent/ai/model-catalog";
import { createAiProvider } from "@/features/agent/ai/provider-registry";

export interface ApiKeyValidationFailure {
  status: Extract<ApiKeyVerificationStatus, "invalid" | "error">;
  message: string;
}

export type ApiKeySaveResult =
  | { ok: true; state: ApiKeyState }
  | { ok: false; cancelled: true }
  | ({ ok: false; cancelled?: false } & ApiKeyValidationFailure);

export function classifyApiKeyValidationFailure(
  error: unknown,
): ApiKeyValidationFailure {
  if (error instanceof AiProviderError && error.code === "authentication") {
    return {
      status: "invalid",
      message: "Invalid API key. The provider rejected this key.",
    };
  }
  return {
    status: "error",
    message:
      error instanceof AiProviderError && error.code === "rate-limit"
        ? "The provider could not validate this key because it is rate-limited. Try again shortly."
        : "The provider is unavailable or could not validate this key. Try again.",
  };
}

export async function validateApiKeyCandidate({
  provider,
  apiKey,
  revision,
  signal,
  force = true,
  discover = discoverAndCacheModels,
}: {
  provider: RunnableAiProviderId;
  apiKey: string;
  revision: number;
  signal: AbortSignal;
  force?: boolean;
  discover?: typeof discoverAndCacheModels;
}): Promise<string> {
  const normalized = createAiProvider(provider).normalizeApiKey(apiKey);
  if (!normalized) {
    throw new AiProviderError("authentication", "The API key is empty.");
  }
  await discover({
    provider,
    apiKey: normalized,
    revision,
    signal,
    force,
  });
  return normalized;
}

export async function validateAndPersistApiKey({
  provider,
  apiKey,
  remember,
  revision,
  storage,
  signal,
  canCommit,
  discover,
}: {
  provider: RunnableAiProviderId;
  apiKey: string;
  remember: boolean;
  revision: number;
  storage: Storage;
  signal: AbortSignal;
  canCommit: () => boolean;
  discover?: typeof discoverAndCacheModels;
}): Promise<ApiKeySaveResult> {
  try {
    const normalized = await validateApiKeyCandidate({
      provider,
      apiKey,
      revision,
      signal,
      discover,
    });
    if (signal.aborted || !canCommit()) {
      return { ok: false, cancelled: true };
    }
    let persisted = remember;
    try {
      persistApiKey(storage, provider, normalized, remember);
    } catch {
      persisted = false;
    }
    return {
      ok: true,
      state: {
        value: normalized,
        persisted,
        revision,
        status: "verified",
        error: "",
      },
    };
  } catch (error) {
    if (signal.aborted) return { ok: false, cancelled: true };
    return {
      ok: false,
      ...classifyApiKeyValidationFailure(error),
    };
  }
}
