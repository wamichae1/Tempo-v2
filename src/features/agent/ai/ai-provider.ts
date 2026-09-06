import type { AgentTool } from "@/features/agent/agent-tool";
import type { AgentErrorCode } from "@/features/agent/agent-chat-state";

export type AiProviderId =
  | "openai"
  | "openrouter"
  | "opencode"
  | "gemini"
  | "nvidia-nim";

export type RunnableAiProviderId = Exclude<AiProviderId, "nvidia-nim">;

export type AiProviderAvailability = "enabled" | "deferred";

export interface AiProviderMetadata {
  id: AiProviderId;
  displayName: string;
  apiKeyStorageKey: string;
  apiKeyPlaceholder: string;
  defaultModelId: string;
  availability: AiProviderAvailability;
  unavailableReason?: string;
}

export interface AIModel {
  id: string;
  providerId: RunnableAiProviderId;
  displayName: string;
  owner?: string;
  description?: string;
  contextWindow?: number;
  toolSupport: "supported" | "unsupported" | "unknown";
}

export interface AiProviderConfig {
  provider: RunnableAiProviderId;
  apiKey: string;
  model: string;
}

export interface AiModelDiscoveryRequest {
  apiKey: string;
  signal: AbortSignal;
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
  readonly id: RunnableAiProviderId;
  readonly metadata: AiProviderMetadata;
  normalizeApiKey(value: string): string;
  discoverModels(request: AiModelDiscoveryRequest): Promise<AIModel[]>;
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
