import type { AgentTool } from "@/features/agent/agent-tool";
import type {
  AiConversationMessage,
  AiProvider,
  AiProviderConfig,
  AiProviderTurnResult,
  AiToolCall,
  AiToolResult,
} from "@/features/agent/ai/ai-provider";
import { AiProviderError } from "@/features/agent/ai/ai-provider";

const DEFAULT_MAX_ROUNDS = 8;
const DEFAULT_MAX_TOOL_CALLS = 16;
const MAX_TOOL_RESULT_CHARS = 50_000;

export interface AgentRuntimeCallbacks {
  onRoundStart?: (round: number) => void;
  onTextDelta?: (text: string, round: number) => void;
  onRoundComplete?: (
    text: string,
    round: number,
    hasToolCalls: boolean,
  ) => void;
  onToolStart?: (
    call: AiToolCall,
    argumentsValue: Record<string, unknown>,
  ) => void;
  onToolComplete?: (
    call: AiToolCall,
    argumentsValue: Record<string, unknown>,
    result: unknown,
    succeeded: boolean,
  ) => void;
}

export interface RunAgentTurnOptions {
  provider: AiProvider;
  config: AiProviderConfig;
  systemPrompt: string;
  conversation: AiConversationMessage[];
  tools: readonly AgentTool[];
  signal: AbortSignal;
  callbacks?: AgentRuntimeCallbacks;
  maxRounds?: number;
  maxToolCalls?: number;
}

export interface AgentTurnResult {
  finalText: string;
  rounds: number;
  toolCalls: number;
}

function abortError(): AiProviderError {
  return new AiProviderError("cancelled", "The request was cancelled.");
}

function parseArguments(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function serializeToolResult(value: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = JSON.stringify({
      ok: false,
      error: "tool returned a result that could not be serialized",
    });
  }
  if (serialized.length <= MAX_TOOL_RESULT_CHARS) return serialized;
  return JSON.stringify({
    ok: false,
    error:
      "tool result was too large; narrow the requested calendar range or query",
  });
}

function resultSucceeded(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return true;
  return (value as { ok?: unknown }).ok !== false;
}

async function receiveProviderTurn(
  provider: AiProvider,
  request: Parameters<AiProvider["stream"]>[0],
  round: number,
  callbacks: AgentRuntimeCallbacks,
): Promise<AiProviderTurnResult> {
  callbacks.onRoundStart?.(round);
  let completed: AiProviderTurnResult | null = null;
  for await (const event of provider.stream(request)) {
    if (event.type === "text-delta") {
      callbacks.onTextDelta?.(event.text, round);
    } else {
      completed = event.result;
    }
  }
  if (!completed) {
    throw new AiProviderError(
      "malformed-response",
      "The AI provider returned no completed response.",
      true,
    );
  }
  callbacks.onRoundComplete?.(
    completed.text,
    round,
    completed.toolCalls.length > 0,
  );
  return completed;
}

export async function runAgentTurn(
  options: RunAgentTurnOptions,
): Promise<AgentTurnResult> {
  const callbacks = options.callbacks ?? {};
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const maxToolCalls = options.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
  const tools = new Map(options.tools.map((tool) => [tool.name, tool]));
  let continuation: unknown;
  let toolResults: AiToolResult[] = [];
  let toolCallCount = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    if (options.signal.aborted) throw abortError();
    const result = await receiveProviderTurn(
      options.provider,
      round === 1
        ? {
            kind: "start",
            config: options.config,
            systemPrompt: options.systemPrompt,
            conversation: options.conversation,
            tools: options.tools,
            signal: options.signal,
          }
        : {
            kind: "continue",
            config: options.config,
            systemPrompt: options.systemPrompt,
            continuation,
            toolResults,
            tools: options.tools,
            signal: options.signal,
          },
      round,
      callbacks,
    );

    continuation = result.continuation;
    if (result.toolCalls.length === 0) {
      return {
        finalText: result.text,
        rounds: round,
        toolCalls: toolCallCount,
      };
    }

    toolResults = [];
    for (const call of result.toolCalls) {
      if (options.signal.aborted) throw abortError();
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        throw new AiProviderError(
          "loop-limit",
          "This request exceeded Tempo's tool execution limit.",
        );
      }

      const argumentsValue = parseArguments(call.argumentsText);
      if (!argumentsValue) {
        const failure = {
          ok: false,
          error: "tool arguments must be a JSON object",
        };
        callbacks.onToolStart?.(call, {});
        callbacks.onToolComplete?.(call, {}, failure, false);
        toolResults.push({
          callId: call.callId,
          output: serializeToolResult(failure),
        });
        continue;
      }

      callbacks.onToolStart?.(call, argumentsValue);
      const tool = tools.get(call.name);
      let toolResult: unknown;
      if (!tool) {
        toolResult = { ok: false, error: `unknown tool "${call.name}"` };
      } else {
        try {
          toolResult = await tool.execute(argumentsValue, {
            signal: options.signal,
          });
        } catch (error) {
          if (options.signal.aborted) throw abortError();
          toolResult = {
            ok: false,
            error:
              error instanceof Error
                ? `tool execution failed: ${error.message}`
                : "tool execution failed",
          };
        }
      }
      const succeeded = resultSucceeded(toolResult);
      callbacks.onToolComplete?.(
        call,
        argumentsValue,
        toolResult,
        succeeded,
      );
      toolResults.push({
        callId: call.callId,
        output: serializeToolResult(toolResult),
      });
    }
  }

  throw new AiProviderError(
    "loop-limit",
    "This request exceeded Tempo's provider round-trip limit.",
  );
}
