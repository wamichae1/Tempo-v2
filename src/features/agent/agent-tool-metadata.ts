import type { CalendarEventsStore } from "@/features/calendar/use-calendar-events";
import { buildAgentTools } from "./agent-handlers";

/**
 * Read-only metadata about Tempo's WebMCP tools, for the Tempo Agent
 * inspector panel.
 *
 * The single source of truth for tool names/titles/descriptions/schemas is
 * `buildAgentTools` (agent-handlers.ts) + `TOOL_SCHEMAS` (agent-tools.ts).
 * This module introspects the built tool objects once with an inert context
 * and never calls `execute`, so it duplicates nothing and mutates nothing.
 */

export type ToolSection = "READ" | "WRITE" | "HISTORY";

export interface AgentToolParam {
  name: string;
  /** Human-readable type, e.g. "string · date-time" or "red | blue". */
  type: string;
  required: boolean;
  description?: string;
  /** Nested properties for object-typed params (e.g. patch, recurrence). */
  children?: AgentToolParam[];
}

export interface AgentToolInfo {
  name: string;
  title: string;
  description: string;
  kind: "READ" | "WRITE";
  section: ToolSection;
  confirmationProtected: boolean;
  params: AgentToolParam[];
}

/**
 * Tools whose execute path goes through the in-app confirmation dialog.
 * Mirrors the `confirm(...)` call sites in agent-handlers.ts — keep in sync.
 */
export const CONFIRMATION_PROTECTED: ReadonlySet<string> = new Set([
  "tempo_push_events",
  "tempo_delete_event",
  "tempo_delete_calendar",
]);

const HISTORY_TOOLS: ReadonlySet<string> = new Set([
  "tempo_undo",
  "tempo_redo",
]);

type SchemaObject = {
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  properties?: Record<string, SchemaObject>;
  required?: string[];
  items?: SchemaObject;
};

function describeType(schema: SchemaObject): string {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(String).join(" | ");
  }
  const base = schema.type ?? "unknown";
  if (base === "array" && schema.items?.type) {
    return `${schema.items.type}[]`;
  }
  return schema.format ? `${base} · ${schema.format}` : base;
}

function extractParams(schema: SchemaObject): AgentToolParam[] {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: describeType(prop),
    required: required.has(name),
    description: prop.description,
    children:
      prop.type === "object" && prop.properties
        ? extractParams(prop)
        : undefined,
  }));
}

let cache: AgentToolInfo[] | null = null;

/**
 * Returns metadata for every Tempo WebMCP tool, in registration order.
 * Builds the tools with a store proxy that throws on any access — execute
 * callbacks are never invoked, so no calendar state is ever touched.
 */
export function getAgentToolMetadata(): AgentToolInfo[] {
  if (cache) return cache;
  const inertStore = new Proxy({} as CalendarEventsStore, {
    get() {
      throw new Error("agent tool metadata must not access the store");
    },
  });
  const tools = buildAgentTools({
    getStore: () => inertStore,
    confirm: () => Promise.resolve(false),
  });
  cache = tools.map((tool) => {
    const readOnly = tool.annotations?.readOnlyHint === true;
    return {
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
      kind: readOnly ? "READ" : "WRITE",
      section: HISTORY_TOOLS.has(tool.name)
        ? "HISTORY"
        : readOnly
          ? "READ"
          : "WRITE",
      confirmationProtected: CONFIRMATION_PROTECTED.has(tool.name),
      params: extractParams(tool.inputSchema as SchemaObject),
    };
  });
  return cache;
}
