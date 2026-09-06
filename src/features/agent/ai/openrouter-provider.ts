import type {
  AIModel,
  AiModelDiscoveryRequest,
  AiProvider,
  AiProviderEvent,
  AiProviderRequest,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";
import { streamOpenAiCompatibleChat } from "@/features/agent/ai/openai-compatible-chat";

interface OpenRouterModel {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  context_length?: unknown;
  supported_parameters?: unknown;
  architecture?: { output_modalities?: unknown };
}

export class OpenRouterProvider implements AiProvider {
  readonly id = "openrouter" as const;
  readonly metadata = {
    id: this.id,
    displayName: "OpenRouter",
    apiKeyStorageKey: "tempo:ai-key:openrouter:v1",
    apiKeyPlaceholder: "sk-or-...",
    defaultModelId: "openrouter/auto",
    availability: "enabled",
  } as const;

  normalizeApiKey(value: string): string {
    return value.trim();
  }

  async discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]> {
    const authorization = `Bearer ${this.normalizeApiKey(request.apiKey)}`;
    let response: Response;
    try {
      const keyResponse = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: authorization },
        signal: request.signal,
      });
      if (keyResponse.status === 401 || keyResponse.status === 403) {
        throw new AiProviderError(
          "authentication",
          "OpenRouter rejected this API key.",
        );
      }
      if (!keyResponse.ok) {
        throw new AiProviderError(
          "provider",
          "OpenRouter could not validate this API key.",
          keyResponse.status >= 500,
        );
      }
      response = await fetch("https://openrouter.ai/api/v1/models", {
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
        "The browser could not reach OpenRouter.",
        true,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new AiProviderError(
        "authentication",
        "OpenRouter rejected this API key.",
      );
    }
    if (!response.ok) {
      throw new AiProviderError(
        "provider",
        "OpenRouter could not load its model catalog.",
        response.status >= 500,
      );
    }

    const payload = (await response.json()) as { data?: OpenRouterModel[] };
    return (payload.data ?? [])
      .flatMap((model): AIModel[] => {
        if (typeof model.id !== "string") return [];
        const outputs = Array.isArray(model.architecture?.output_modalities)
          ? model.architecture.output_modalities
          : [];
        const parameters = Array.isArray(model.supported_parameters)
          ? model.supported_parameters
          : [];
        if (model.id.endsWith(":batch") || (outputs.length > 0 && !outputs.includes("text"))) {
          return [];
        }
        return [{
          id: model.id,
          providerId: this.id,
          displayName: typeof model.name === "string" ? model.name : model.id,
          description:
            typeof model.description === "string" ? model.description : undefined,
          contextWindow:
            typeof model.context_length === "number"
              ? model.context_length
              : undefined,
          toolSupport: parameters.includes("tools") ? "supported" : "unsupported",
        }];
      })
      .filter((model) => model.toolSupport !== "unsupported")
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  stream(request: AiProviderRequest): AsyncIterable<AiProviderEvent> {
    return streamOpenAiCompatibleChat({
      request,
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      providerName: "OpenRouter",
      headers: {
        "HTTP-Referer": window.location.origin,
        "X-OpenRouter-Title": "Tempo",
      },
    });
  }
}
