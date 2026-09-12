import type {
  AiProviderEvent,
  AiProviderRequest,
  AiProviderTurnResult,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";
import { readJsonSse } from "@/features/agent/ai/sse";

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ChatToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface ChatContinuation {
  messages: ChatMessage[];
}

interface ChatChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

function continuationMessages(value: unknown): ChatMessage[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as Partial<ChatContinuation>).messages)
  ) {
    return [];
  }
  return (value as ChatContinuation).messages;
}

function classifyHttpError(
  response: Response,
  providerName: string,
): AiProviderError {
  if (response.status === 401 || response.status === 403) {
    return new AiProviderError(
      "authentication",
      `${providerName} rejected this API key. Check the key and try again.`,
    );
  }
  if (response.status === 404) {
    return new AiProviderError(
      "unsupported-model",
      `${providerName} could not find the configured model.`,
    );
  }
  if (response.status === 429) {
    return new AiProviderError(
      "rate-limit",
      `${providerName} rate-limited this request. Wait briefly and try again.`,
      true,
    );
  }
  return new AiProviderError(
    "provider",
    response.status >= 500
      ? `${providerName} is temporarily unavailable. Try again shortly.`
      : `${providerName} could not complete the request.`,
    response.status >= 500,
  );
}

export async function* streamOpenAiCompatibleChat({
  request,
  endpoint,
  providerName,
  headers,
  bodyExtras,
  classifyResponse,
}: {
  request: AiProviderRequest;
  endpoint: string;
  providerName: string;
  headers?: Record<string, string>;
  bodyExtras?: (request: AiProviderRequest) => Record<string, unknown>;
  classifyResponse?: (response: Response) => AiProviderError;
}): AsyncIterable<AiProviderEvent> {
  const baseMessages: ChatMessage[] =
    request.kind === "start"
      ? [
          { role: "system", content: request.systemPrompt },
          ...request.conversation.map(
            (message): ChatMessage => ({
              role: message.role,
              content: message.text,
            }),
          ),
        ]
      : [
          ...continuationMessages(request.continuation),
          ...request.toolResults.map(
            (result): ChatMessage => ({
              role: "tool",
              tool_call_id: result.callId,
              content: result.output,
            }),
          ),
        ];

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.config.apiKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({
        ...bodyExtras?.(request),
        model: request.config.model,
        messages: baseMessages,
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        parallel_tool_calls: false,
        stream: true,
      }),
      signal: request.signal,
    });
  } catch {
    if (request.signal.aborted) {
      throw new AiProviderError("cancelled", "The request was cancelled.");
    }
    throw new AiProviderError(
      "network",
      `The browser could not reach ${providerName}. Check your connection and browser privacy settings.`,
      true,
    );
  }

  if (!response.ok) {
    throw classifyResponse?.(response) ??
      classifyHttpError(response, providerName);
  }

  let text = "";
  const calls = new Map<
    number,
    { id: string; name: string; argumentsText: string }
  >();

  for await (const rawChunk of readJsonSse(response, request.signal)) {
    const chunk = rawChunk as ChatChunk;
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (delta.content) {
      text += delta.content;
      yield { type: "text-delta", text: delta.content };
    }
    for (const toolDelta of delta.tool_calls ?? []) {
      const index = toolDelta.index ?? calls.size;
      const current = calls.get(index) ?? {
        id: "",
        name: "",
        argumentsText: "",
      };
      if (toolDelta.id) current.id = toolDelta.id;
      if (toolDelta.function?.name) current.name += toolDelta.function.name;
      if (toolDelta.function?.arguments) {
        current.argumentsText += toolDelta.function.arguments;
      }
      calls.set(index, current);
    }
  }

  const toolCalls: ChatToolCall[] = [...calls.values()].map((call) => ({
    id: call.id,
    type: "function",
    function: { name: call.name, arguments: call.argumentsText },
  }));
  const assistant: ChatMessage = {
    role: "assistant",
    content: text || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  };
  const completed: AiProviderTurnResult = {
    text,
    toolCalls: toolCalls.map((call) => ({
      callId: call.id,
      name: call.function.name,
      argumentsText: call.function.arguments,
    })),
    continuation: { messages: [...baseMessages, assistant] } satisfies ChatContinuation,
  };
  yield { type: "completed", result: completed };
}
