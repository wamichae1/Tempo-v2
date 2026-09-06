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

export class OpenCodeProvider implements AiProvider {
  readonly id = "opencode" as const;
  readonly metadata = {
    id: this.id,
    displayName: "OpenCode",
    apiKeyStorageKey: "tempo:ai-key:opencode:v1",
    apiKeyPlaceholder: "OpenCode Zen API key",
    defaultModelId: "gpt-5.4-mini",
    availability: "enabled",
  } as const;

  normalizeApiKey(value: string): string {
    return value.trim();
  }

  async discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]> {
    let response: Response;
    try {
      response = await fetch("https://opencode.ai/zen/v1/models", {
        headers: { Authorization: `Bearer ${this.normalizeApiKey(request.apiKey)}` },
        signal: request.signal,
      });
    } catch {
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
