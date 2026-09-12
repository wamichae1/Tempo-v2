import type {
  AIModel,
  AiModelDiscoveryRequest,
  AiProvider,
  AiProviderEvent,
  AiProviderRequest,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";
import { streamOpenAiCompatibleChat } from "@/features/agent/ai/openai-compatible-chat";

const GROQ_API = "https://api.groq.com/openai/v1";

interface GroqModel {
  id?: unknown;
  owned_by?: unknown;
  active?: unknown;
  context_window?: unknown;
}

interface CuratedGroqModel {
  id: string;
  displayName: string;
  description: string;
  contextWindow: number;
}

const CURATED_MODELS: readonly CuratedGroqModel[] = [
  {
    id: "openai/gpt-oss-20b",
    displayName: "GPT-OSS 20B",
    description:
      "Fast, cost-efficient reasoning model for tool-driven calendar tasks.",
    contextWindow: 131_072,
  },
  {
    id: "openai/gpt-oss-120b",
    displayName: "GPT-OSS 120B",
    description:
      "Higher-capability reasoning model for complex scheduling and planning.",
    contextWindow: 131_072,
  },
] as const;

function discoveryError(response: Response): AiProviderError {
  if (response.status === 401 || response.status === 403) {
    return new AiProviderError(
      "authentication",
      "Groq rejected this API key. Check the key and project access.",
    );
  }
  if (response.status === 429 || response.status === 498) {
    return new AiProviderError(
      "rate-limit",
      "Groq could not validate this key because capacity is limited. Try again shortly.",
      true,
    );
  }
  return new AiProviderError(
    "provider",
    response.status >= 500
      ? "Groq is temporarily unavailable. Try again shortly."
      : "Groq could not load its model catalog.",
    response.status >= 500,
  );
}

function completionError(response: Response): AiProviderError {
  if (response.status === 401) {
    return new AiProviderError(
      "authentication",
      "Groq rejected this API key. Check the key and try again.",
    );
  }
  if (response.status === 403 || response.status === 404) {
    return new AiProviderError(
      "unsupported-model",
      response.status === 403
        ? "This Groq key or project does not have access to the configured model."
        : "Groq could not find the configured model.",
    );
  }
  if (response.status === 413) {
    return new AiProviderError(
      "provider",
      "This request is too large for the configured Groq model.",
    );
  }
  if (response.status === 422) {
    return new AiProviderError(
      "provider",
      "Groq could not process this request. Try again.",
      true,
    );
  }
  if (response.status === 429 || response.status === 498) {
    return new AiProviderError(
      "rate-limit",
      "Groq is rate-limited or temporarily at capacity. Wait briefly and try again.",
      true,
    );
  }
  return new AiProviderError(
    "provider",
    response.status >= 500
      ? "Groq is temporarily unavailable. Try again shortly."
      : "Groq could not complete the request.",
    response.status >= 500,
  );
}

export class GroqProvider implements AiProvider {
  readonly id = "groq" as const;
  readonly metadata = {
    id: this.id,
    displayName: "Groq",
    apiKeyStorageKey: "tempo:ai-key:groq:v1",
    apiKeyPlaceholder: "gsk_...",
    defaultModelId: "openai/gpt-oss-20b",
    availability: "enabled",
  } as const;

  normalizeApiKey(value: string): string {
    return value.trim();
  }

  async discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]> {
    let response: Response;
    try {
      response = await fetch(`${GROQ_API}/models`, {
        headers: {
          Authorization: `Bearer ${this.normalizeApiKey(request.apiKey)}`,
        },
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) {
        throw new AiProviderError("cancelled", "The request was cancelled.");
      }
      throw new AiProviderError(
        "network",
        "The browser could not reach Groq. Check your connection and browser privacy settings.",
        true,
      );
    }
    if (!response.ok) throw discoveryError(response);

    const payload = (await response.json()) as { data?: GroqModel[] };
    const available = new Map(
      (payload.data ?? [])
        .filter(
          (model): model is GroqModel & { id: string } =>
            typeof model.id === "string" && model.active !== false,
        )
        .map((model) => [model.id, model]),
    );

    return CURATED_MODELS.flatMap((curated): AIModel[] => {
      const model = available.get(curated.id);
      if (!model) return [];
      return [{
        id: curated.id,
        providerId: this.id,
        displayName: curated.displayName,
        owner:
          typeof model.owned_by === "string" ? model.owned_by : "Groq",
        description: curated.description,
        contextWindow:
          typeof model.context_window === "number"
            ? model.context_window
            : curated.contextWindow,
        toolSupport: "supported",
      }];
    });
  }

  stream(request: AiProviderRequest): AsyncIterable<AiProviderEvent> {
    return streamOpenAiCompatibleChat({
      request,
      endpoint: `${GROQ_API}/chat/completions`,
      providerName: "Groq",
      bodyExtras: (current) =>
        current.config.model.startsWith("openai/gpt-oss-")
          ? { reasoning_format: "hidden" }
          : {},
      classifyResponse: completionError,
    });
  }
}
