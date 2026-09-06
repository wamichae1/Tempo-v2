import type {
  AIModel,
  AiModelDiscoveryRequest,
  AiProvider,
  AiProviderEvent,
  AiProviderRequest,
  AiProviderTurnResult,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";
import { readJsonSse } from "@/features/agent/ai/sse";

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";

interface GeminiModel {
  name?: unknown;
  displayName?: unknown;
  description?: unknown;
  inputTokenLimit?: unknown;
  supportedGenerationMethods?: unknown;
}

interface GeminiContinuation {
  input: unknown[];
}

interface GeminiStreamEvent {
  event_type?: unknown;
  type?: unknown;
  delta?: { text?: unknown };
  interaction?: { outputs?: unknown };
}

function continuationInput(value: unknown): unknown[] {
  if (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as Partial<GeminiContinuation>).input)
  ) {
    return (value as GeminiContinuation).input;
  }
  return [];
}

function extractOutputs(outputs: unknown): {
  text: string;
  toolCalls: AiProviderTurnResult["toolCalls"];
} {
  if (!Array.isArray(outputs)) return { text: "", toolCalls: [] };
  let text = "";
  const toolCalls: AiProviderTurnResult["toolCalls"] = [];
  for (const output of outputs) {
    if (typeof output !== "object" || output === null) continue;
    const item = output as Record<string, unknown>;
    if (item.type === "text" && typeof item.text === "string") {
      text += item.text;
    }
    if (
      item.type === "function_call" &&
      typeof item.call_id === "string" &&
      typeof item.name === "string"
    ) {
      toolCalls.push({
        callId: item.call_id,
        name: item.name,
        argumentsText:
          typeof item.arguments === "string"
            ? item.arguments
            : JSON.stringify(item.arguments ?? {}),
      });
    }
  }
  return { text, toolCalls };
}

function functionNameForCall(input: unknown[], callId: string): string | undefined {
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    if (
      record.type === "function_call" &&
      record.call_id === callId &&
      typeof record.name === "string"
    ) {
      return record.name;
    }
  }
  return undefined;
}

function parseFunctionResult(output: string): unknown {
  try {
    return JSON.parse(output) as unknown;
  } catch {
    return { output };
  }
}

function classifyResponse(response: Response): AiProviderError {
  if (response.status === 401 || response.status === 403) {
    return new AiProviderError(
      "authentication",
      "Google Gemini rejected this API key.",
    );
  }
  if (response.status === 404) {
    return new AiProviderError(
      "unsupported-model",
      "Google Gemini could not find the configured model.",
    );
  }
  if (response.status === 429) {
    return new AiProviderError(
      "rate-limit",
      "Google Gemini rate-limited this request.",
      true,
    );
  }
  return new AiProviderError(
    "provider",
    response.status >= 500
      ? "Google Gemini is temporarily unavailable."
      : "Google Gemini could not complete the request.",
    response.status >= 500,
  );
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;
  readonly metadata = {
    id: this.id,
    displayName: "Google Gemini",
    apiKeyStorageKey: "tempo:ai-key:gemini:v1",
    apiKeyPlaceholder: "Google AI API key",
    defaultModelId: "gemini-3.7-flash",
    availability: "enabled",
  } as const;

  normalizeApiKey(value: string): string {
    return value.trim();
  }

  async discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]> {
    let response: Response;
    try {
      response = await fetch(`${GEMINI_API}/models`, {
        headers: { "x-goog-api-key": this.normalizeApiKey(request.apiKey) },
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) {
        throw new AiProviderError("cancelled", "The request was cancelled.");
      }
      throw new AiProviderError(
        "network",
        "The browser could not reach Google Gemini.",
        true,
      );
    }
    if (!response.ok) throw classifyResponse(response);
    const payload = (await response.json()) as { models?: GeminiModel[] };
    return (payload.models ?? [])
      .flatMap((model): AIModel[] => {
        if (typeof model.name !== "string") return [];
        const methods = Array.isArray(model.supportedGenerationMethods)
          ? model.supportedGenerationMethods
          : [];
        if (
          methods.length > 0 &&
          !methods.includes("generateContent") &&
          !methods.includes("createInteraction")
        ) {
          return [];
        }
        const id = model.name.replace(/^models\//, "");
        return [{
          id,
          providerId: this.id,
          displayName:
            typeof model.displayName === "string" ? model.displayName : id,
          description:
            typeof model.description === "string" ? model.description : undefined,
          contextWindow:
            typeof model.inputTokenLimit === "number"
              ? model.inputTokenLimit
              : undefined,
          toolSupport: "unknown",
        }];
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async *stream(request: AiProviderRequest): AsyncIterable<AiProviderEvent> {
    const priorInput =
      request.kind === "start"
        ? request.conversation.map((message) => ({
            role: message.role === "assistant" ? "model" : "user",
            content: [{ type: "text", text: message.text }],
          }))
        : continuationInput(request.continuation);
    const input =
      request.kind === "continue"
        ? [
            ...priorInput,
            ...request.toolResults.map((result) => ({
              type: "function_result",
              call_id: result.callId,
              name: functionNameForCall(priorInput, result.callId),
              result: parseFunctionResult(result.output),
            })),
          ]
        : priorInput;

    let response: Response;
    try {
      response = await fetch(`${GEMINI_API}/interactions?alt=sse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.normalizeApiKey(request.config.apiKey),
        },
        body: JSON.stringify({
          model: request.config.model,
          system_instruction: request.systemPrompt,
          input,
          tools: request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          })),
          stream: true,
          store: false,
        }),
        signal: request.signal,
      });
    } catch {
      if (request.signal.aborted) {
        throw new AiProviderError("cancelled", "The request was cancelled.");
      }
      throw new AiProviderError(
        "network",
        "The browser could not reach Google Gemini.",
        true,
      );
    }
    if (!response.ok) throw classifyResponse(response);

    let streamedText = "";
    let completed: AiProviderTurnResult | null = null;
    for await (const rawEvent of readJsonSse(response, request.signal)) {
      const event = rawEvent as GeminiStreamEvent;
      const eventType = event.event_type ?? event.type;
      if (eventType === "step.delta" && typeof event.delta?.text === "string") {
        streamedText += event.delta.text;
        yield { type: "text-delta", text: event.delta.text };
      }
      if (eventType === "interaction.complete") {
        const outputs = event.interaction?.outputs;
        const normalized = extractOutputs(outputs);
        completed = {
          text: normalized.text || streamedText,
          toolCalls: normalized.toolCalls,
          continuation: {
            input: [...input, ...(Array.isArray(outputs) ? outputs : [])],
          } satisfies GeminiContinuation,
        };
      }
    }
    if (!completed) {
      throw new AiProviderError(
        "malformed-response",
        "Google Gemini ended the stream without a completed interaction.",
        true,
      );
    }
    yield { type: "completed", result: completed };
  }
}
