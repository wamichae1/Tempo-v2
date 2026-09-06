/**
 * Provider-neutral contract for a Tempo agent tool.
 *
 * The same tool objects are registered with WebMCP and executed by Tempo's
 * built-in BYOK runtime.
 */
export interface AgentToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface AgentToolExecuteOptions {
  signal: AbortSignal;
}

export interface AgentTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    options: AgentToolExecuteOptions,
  ) => Promise<unknown>;
  annotations?: AgentToolAnnotations;
}
