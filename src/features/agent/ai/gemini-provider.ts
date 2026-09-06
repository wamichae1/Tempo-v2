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
  index?: unknown;
  step_index?: unknown;
  step?: unknown;
  delta?: unknown;
  error?: unknown;
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

function cloneRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return structuredClone(value as Record<string, unknown>);
}

function textFromContent(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part !== "object" || part === null) return "";
      const item = part as Record<string, unknown>;
      return item.type === "text" && typeof item.text === "string"
        ? item.text
        : "";
    })
    .join("");
}

function appendTextDelta(step: Record<string, unknown>, text: string): void {
  const content = Array.isArray(step.content)
    ? structuredClone(step.content)
    : [];
  const last = content.at(-1);
  if (
    typeof last === "object" &&
    last !== null &&
    (last as Record<string, unknown>).type === "text" &&
    typeof (last as Record<string, unknown>).text === "string"
  ) {
    (last as Record<string, unknown>).text += text;
  } else {
    content.push({ type: "text", text });
  }
  step.content = content;
}

function eventIndex(event: GeminiStreamEvent, fallback: number): number {
  if (typeof event.index === "number") return event.index;
  if (typeof event.step_index === "number") return event.step_index;
  return fallback;
}

function argumentsText(value: unknown): string {
  return typeof value === "string"
    ? value
    : JSON.stringify(value ?? {});
}

function parseArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function extractSteps(steps: unknown[]): {
  text: string;
  toolCalls: AiProviderTurnResult["toolCalls"];
} {
  let text = "";
  const toolCalls: AiProviderTurnResult["toolCalls"] = [];
  for (const step of steps) {
    if (typeof step !== "object" || step === null) continue;
    const item = step as Record<string, unknown>;
    if (item.type === "model_output") {
      text += textFromContent(item.content);
    }
    if (
      item.type === "function_call" &&
      typeof item.id === "string" &&
      typeof item.name === "string"
    ) {
      toolCalls.push({
        callId: item.id,
        name: item.name,
        argumentsText: argumentsText(item.arguments),
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
      record.id === callId &&
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

function classifyStreamError(event: GeminiStreamEvent): AiProviderError {
  const error =
    typeof event.error === "object" && event.error !== null
      ? (event.error as Record<string, unknown>)
      : {};
  const code = error.code;
  if (code === 401 || code === 403 || code === "UNAUTHENTICATED") {
    return new AiProviderError(
      "authentication",
      "Google Gemini rejected this API key.",
    );
  }
  if (code === 404 || code === "NOT_FOUND") {
    return new AiProviderError(
      "unsupported-model",
      "Google Gemini could not find the configured model.",
    );
  }
  if (code === 429 || code === "RESOURCE_EXHAUSTED") {
    return new AiProviderError(
      "rate-limit",
      "Google Gemini rate-limited this request.",
      true,
    );
  }
  return new AiProviderError(
    "provider",
    "Google Gemini could not complete the request.",
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
            type: message.role === "assistant" ? "model_output" : "user_input",
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
      response = await fetch(`${GEMINI_API}/interactions`, {
        method: "POST",
        headers: {
          Accept: "text/event-stream",
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
    let interactionCompleted = false;
    const steps = new Map<
      number,
      { step: Record<string, unknown>; argumentsText: string }
    >();
    for await (const rawEvent of readJsonSse(response, request.signal)) {
      const event = rawEvent as GeminiStreamEvent;
      const eventType = event.event_type ?? event.type;
      if (eventType === "error") throw classifyStreamError(event);

      if (eventType === "step.start") {
        const step = cloneRecord(event.step);
        if (!step) continue;
        const index = eventIndex(event, steps.size);
        const initialText =
          step.type === "model_output" ? textFromContent(step.content) : "";
        if (initialText) {
          streamedText += initialText;
          yield { type: "text-delta", text: initialText };
        }
        steps.set(index, {
          step,
          argumentsText: "",
        });
      }

      if (eventType === "step.delta") {
        const delta = cloneRecord(event.delta);
        if (!delta) continue;
        const index = eventIndex(event, Math.max(steps.size - 1, 0));
        const current = steps.get(index);
        if (!current) continue;
        if (delta.type === "text" && typeof delta.text === "string") {
          appendTextDelta(current.step, delta.text);
          streamedText += delta.text;
          yield { type: "text-delta", text: delta.text };
        }
        if (
          (delta.type === "arguments_delta" ||
            delta.type === "function_call_arguments") &&
          (typeof delta.arguments === "string" ||
            typeof delta.arguments_delta === "string")
        ) {
          current.argumentsText +=
            typeof delta.arguments === "string"
              ? delta.arguments
              : delta.arguments_delta as string;
          current.step.arguments = parseArguments(current.argumentsText);
        }
      }

      if (eventType === "step.stop") {
        const step = cloneRecord(event.step);
        if (!step) continue;
        const index = eventIndex(event, Math.max(steps.size - 1, 0));
        steps.set(index, {
          step,
          argumentsText:
            step.type === "function_call"
              ? argumentsText(step.arguments)
              : "",
        });
      }

      if (eventType === "interaction.completed") {
        interactionCompleted = true;
      }
    }
    if (!interactionCompleted) {
      throw new AiProviderError(
        "malformed-response",
        "Google Gemini ended the stream without a completed interaction.",
        true,
      );
    }
    const completedSteps = [...steps.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, value]) => value.step);
    const normalized = extractSteps(completedSteps);
    yield {
      type: "completed",
      result: {
        text: normalized.text || streamedText,
        toolCalls: normalized.toolCalls,
        continuation: {
          input: [...input, ...completedSteps],
        } satisfies GeminiContinuation,
      },
    };
  }
}
