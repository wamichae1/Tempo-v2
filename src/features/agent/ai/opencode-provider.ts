import type {
  AIModel,
  AiModelDiscoveryRequest,
  AiProvider,
  AiProviderEvent,
  AiProviderRequest,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";
import { streamOpenAiCompatibleChat } from "@/features/agent/ai/openai-compatible-chat";

interface OpenCodeModel {
  id?: unknown;
  owned_by?: unknown;
}

function classifyAuthProbe(response: Response): AiProviderError | null {
  if (response.ok || response.status === 400 || response.status === 422) {
    return null;
  }
  if (response.status === 401 || response.status === 403) {
    return new AiProviderError(
      "authentication",
      "OpenCode rejected this API key.",
    );
  }
  if (response.status === 429) {
    return new AiProviderError(
      "rate-limit",
      "OpenCode rate-limited API key validation.",
      true,
    );
  }
  return new AiProviderError(
    "provider",
    "OpenCode could not validate this API key.",
    response.status >= 500,
  );
}

export class OpenCodeProvider implements AiProvider {
  readonly id = "opencode" as const;
  readonly metadata = {
    id: this.id,
    displayName: "OpenCode",
    apiKeyStorageKey: "tempo:ai-key:opencode:v1",
    apiKeyPlaceholder: "OpenCode Zen API key",
    defaultModelId: "gpt-5.4-mini",
    availability: "deferred",
    availabilityLabel: "Unavailable in browser",
    unavailableReason:
      "OpenCode Zen does not currently permit the browser access required by Tempo's static deployment.",
  } as const;

  normalizeApiKey(value: string): string {
    return value.trim();
  }

  async discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]> {
    const authorization = `Bearer ${this.normalizeApiKey(request.apiKey)}`;
    let response: Response;
    try {
      const authResponse = await fetch(
        "https://opencode.ai/zen/v1/responses",
        {
          method: "POST",
          headers: {
            Authorization: authorization,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: this.metadata.defaultModelId }),
          signal: request.signal,
        },
      );
      const authError = classifyAuthProbe(authResponse);
      if (authError) throw authError;
      response = await fetch("https://opencode.ai/zen/v1/models", {
        headers: { Authorization: authorization },
        signal: request.signal,
      });
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (request.signal.aborted) {
        throw new AiProviderError("cancelled", "The request was cancelled.");
      }
      throw new AiProviderError(
        "network",
        "The browser could not reach OpenCode.",
        true,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new AiProviderError(
        "authentication",
        "OpenCode rejected this API key.",
      );
    }
    if (!response.ok) {
      throw new AiProviderError(
        "provider",
        "OpenCode could not load its model catalog.",
        response.status >= 500,
      );
    }
    const payload = (await response.json()) as { data?: OpenCodeModel[] };
    return (payload.data ?? [])
      .flatMap((model): AIModel[] =>
        typeof model.id === "string"
          ? [{
              id: model.id,
              providerId: this.id,
              displayName: model.id,
              owner:
                typeof model.owned_by === "string" ? model.owned_by : undefined,
              toolSupport: "unknown",
            }]
          : [],
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  stream(request: AiProviderRequest): AsyncIterable<AiProviderEvent> {
    return streamOpenAiCompatibleChat({
      request,
      endpoint: "https://opencode.ai/zen/v1/chat/completions",
      providerName: "OpenCode",
    });
  }
}
