import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";

import type {
  AIModel,
  AiConversationMessage,
  AiModelDiscoveryRequest,
  AiProvider,
  AiProviderEvent,
  AiProviderRequest,
  AiProviderTurnResult,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";

const NON_CHAT_MODEL =
  /(?:embedding|moderation|whisper|tts|transcribe|image|dall-e|realtime|audio)/i;

function mapConversation(
  conversation: AiConversationMessage[],
): ResponseInputItem[] {
  return conversation.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function mapTools(request: AiProviderRequest) {
  return request.tools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  }));
}

function continuationItems(value: unknown): ResponseInputItem[] {
  return Array.isArray(value) ? (value as ResponseInputItem[]) : [];
}

function classifyError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new AiProviderError("cancelled", "The request was cancelled.");
  }
  if (error instanceof OpenAI.APIUserAbortError) {
    return new AiProviderError("cancelled", "The request was cancelled.");
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AiProviderError(
      "network",
      "The browser could not reach OpenAI. Check your connection and browser privacy settings.",
      true,
    );
  }
  if (error instanceof OpenAI.APIError) {
    if (error.status === 401 || error.status === 403) {
      return new AiProviderError(
        "authentication",
        "OpenAI rejected this API key. Check the key and try again.",
      );
    }
    if (error.status === 404 || error.code === "model_not_found") {
      return new AiProviderError(
        "unsupported-model",
        "OpenAI could not find the configured model. Check the model name.",
      );
    }
    if (error.status === 429) {
      return new AiProviderError(
        "rate-limit",
        "OpenAI rate-limited this request. Wait briefly and try again.",
        true,
      );
    }
    if (error.status !== undefined && error.status >= 500) {
      return new AiProviderError(
        "provider",
        "OpenAI is temporarily unavailable. Try again shortly.",
        true,
      );
    }
    return new AiProviderError(
      "provider",
      "OpenAI could not complete the request. Check the model and account access.",
    );
  }
  if (error instanceof TypeError) {
    return new AiProviderError(
      "network",
      "The browser could not reach OpenAI. Check your connection and browser privacy settings.",
      true,
    );
  }
  return new AiProviderError(
    "unknown",
    "The AI provider returned an unexpected error.",
    true,
  );
}

export class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly metadata = {
    id: this.id,
    displayName: "OpenAI",
    apiKeyStorageKey: "tempo:ai-key:openai:v1",
    apiKeyPlaceholder: "sk-...",
    defaultModelId: "gpt-5-mini",
    availability: "enabled",
  } as const;

  normalizeApiKey(value: string): string {
    return value.trim();
  }

  async discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]> {
    try {
      const client = new OpenAI({
        apiKey: this.normalizeApiKey(request.apiKey),
        dangerouslyAllowBrowser: true,
      });
      const page = await client.models.list({ signal: request.signal });
      return page.data
        .filter((model) => !NON_CHAT_MODEL.test(model.id))
        .map((model) => ({
          id: model.id,
          providerId: this.id,
          displayName: model.id,
          owner: model.owned_by,
          toolSupport: "unknown" as const,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    } catch (error) {
      throw classifyError(error);
    }
  }

  async *stream(request: AiProviderRequest): AsyncIterable<AiProviderEvent> {
    try {
      const client = new OpenAI({
        apiKey: request.config.apiKey,
        dangerouslyAllowBrowser: true,
      });
      const input: ResponseInputItem[] =
        request.kind === "start"
          ? mapConversation(request.conversation)
          : [
              ...continuationItems(request.continuation),
              ...request.toolResults.map(
                (result): ResponseInputItem => ({
                  type: "function_call_output",
                  call_id: result.callId,
                  output: result.output,
                }),
              ),
            ];

      const stream = await client.responses.create(
        {
          model: request.config.model,
          instructions: request.systemPrompt,
          input,
          tools: mapTools(request),
          parallel_tool_calls: false,
          store: false,
          stream: true,
        },
        { signal: request.signal },
      );

      let completed: AiProviderTurnResult | null = null;
      for await (const event of stream) {
        if (event.type === "response.output_text.delta") {
          yield { type: "text-delta", text: event.delta };
          continue;
        }
        if (event.type === "response.failed") {
          throw new AiProviderError(
            "provider",
            "OpenAI could not complete the response.",
            true,
          );
        }
        if (event.type === "response.incomplete") {
          throw new AiProviderError(
            "malformed-response",
            "OpenAI returned an incomplete response.",
            true,
          );
        }
        if (event.type === "response.completed") {
          const response = event.response;
          completed = {
            text: response.output_text,
            toolCalls: response.output
              .filter((item) => item.type === "function_call")
              .map((item) => ({
                callId: item.call_id,
                name: item.name,
                argumentsText: item.arguments,
              })),
            continuation: response.output,
          };
        }
      }

      if (!completed) {
        throw new AiProviderError(
          "malformed-response",
          "OpenAI ended the stream without a completed response.",
          true,
        );
      }
      yield { type: "completed", result: completed };
    } catch (error) {
      throw classifyError(error);
    }
  }
}
