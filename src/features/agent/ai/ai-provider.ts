import type { AgentTool } from "@/features/agent/agent-tool";
import type { AgentErrorCode } from "@/features/agent/agent-chat-state";

export type AiProviderId = "openai";

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey: string;
  model: string;
}

export interface AiConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AiToolCall {
  callId: string;
  name: string;
  argumentsText: string;
}

export interface AiToolResult {
  callId: string;
  output: string;
}

export interface AiProviderTurnResult {
  text: string;
  toolCalls: AiToolCall[];
  /** Provider-owned data used only for the next request in this active run. */
  continuation: unknown;
}

interface AiProviderRequestBase {
  config: AiProviderConfig;
  systemPrompt: string;
  tools: readonly AgentTool[];
  signal: AbortSignal;
}

export interface AiProviderStartRequest extends AiProviderRequestBase {
  kind: "start";
  conversation: AiConversationMessage[];
}

export interface AiProviderContinueRequest extends AiProviderRequestBase {
  kind: "continue";
  continuation: unknown;
  toolResults: AiToolResult[];
}

export type AiProviderRequest =
  | AiProviderStartRequest
  | AiProviderContinueRequest;

export type AiProviderEvent =
  | { type: "text-delta"; text: string }
  | { type: "completed"; result: AiProviderTurnResult };

export interface AiProvider {
  readonly id: AiProviderId;
  stream(request: AiProviderRequest): AsyncIterable<AiProviderEvent>;
}

export class AiProviderError extends Error {
  readonly code: AgentErrorCode;
  readonly retryable: boolean;

  constructor(code: AgentErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}
