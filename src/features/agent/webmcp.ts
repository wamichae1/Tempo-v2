import type { AgentTool } from "@/features/agent/agent-tool";

/**
 * Thin typed wrapper around the WebMCP API (`document.modelContext`).
 *
 * Spec: https://webmachinelearning.github.io/webmcp/
 * - SecureContext only; `document.modelContext` may be undefined in
 *   unsupported browsers — always feature-detect first.
 * - Tools are unregistered by aborting the AbortSignal passed at
 *   registration (there is no `unregisterTool` method).
 */

/** @deprecated Import AgentTool from agent-tool.ts instead. */
export type WebMcpTool = AgentTool;

interface ModelContextLike {
  registerTool(
    tool: AgentTool,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  getTools(): Promise<Array<{ name: string; description?: string }>>;
}

declare global {
  interface Document {
    readonly modelContext?: ModelContextLike;
  }
}

export function isWebMcpSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.modelContext?.registerTool === "function"
  );
}

/**
 * Registers a set of tools. Returns the names that registered successfully.
 * Failures (e.g. duplicate names) are logged and skipped so one bad tool
 * never blocks the rest.
 */
export async function registerTools(
  tools: readonly AgentTool[],
  signal: AbortSignal,
): Promise<string[]> {
  const mc = document.modelContext;
  if (!mc) return [];
  const registered: string[] = [];
  for (const tool of tools) {
    if (signal.aborted) break;
    try {
      await mc.registerTool(tool, { signal });
      registered.push(tool.name);
    } catch (err) {
      console.warn(`[webmcp] failed to register "${tool.name}":`, err);
    }
  }
  return registered;
}

/** Lists tools currently visible to this document (for the Agent panel). */
export async function listRegisteredTools(): Promise<
  Array<{ name: string; description?: string }>
> {
  const mc = document.modelContext;
  if (!mc) return [];
  try {
    return await mc.getTools();
  } catch {
    return [];
  }
}
