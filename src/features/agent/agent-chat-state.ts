export const CHAT_STORAGE_KEY = "tempo:agent-chat:v2";
export const LEGACY_CHAT_STORAGE_KEY = "tempo:agent-chat:v1";
export const MAX_PERSISTED_ENTRIES = 100;

export type AgentChatMessageStatus =
  | "complete"
  | "streaming"
  | "cancelled"
  | "error";

export interface AgentChatMessage {
  kind: "message";
  id: string;
  role: "user" | "assistant";
  text: string;
  status: AgentChatMessageStatus;
  createdAt: string;
}

export type AgentChatToolStatus =
  | "requested"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface AgentChatToolActivity {
  kind: "tool";
  id: string;
  callId: string;
  toolName: string;
  status: AgentChatToolStatus;
  arguments: Record<string, unknown>;
  result?: unknown;
  createdAt: string;
}

export type AgentErrorCode =
  | "missing-key"
  | "authentication"
  | "unsupported-model"
  | "rate-limit"
  | "network"
  | "provider"
  | "malformed-response"
  | "tool"
  | "loop-limit"
  | "cancelled"
  | "unknown";

export interface AgentChatError {
  kind: "error";
  id: string;
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
  createdAt: string;
}

export type AgentChatEntry =
  | AgentChatMessage
  | AgentChatToolActivity
  | AgentChatError;

interface StoredChatV2 {
  version: 2;
  entries: AgentChatEntry[];
}

interface StoredChatV1 {
  version: 1;
  messages: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > 10_000
      ? `${value.slice(0, 10_000)}[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => safeJsonValue(item, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/api[-_]?key|authorization|continuation/i.test(key))
        .slice(0, 100)
        .map(([key, item]) => [key, safeJsonValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function isMessage(value: unknown): value is AgentChatMessage {
  if (!isRecord(value)) return false;
  return (
    value.kind === "message" &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.text === "string" &&
    (value.status === "complete" ||
      value.status === "streaming" ||
      value.status === "cancelled" ||
      value.status === "error") &&
    typeof value.createdAt === "string"
  );
}

function isTool(value: unknown): value is AgentChatToolActivity {
  if (!isRecord(value)) return false;
  return (
    value.kind === "tool" &&
    typeof value.id === "string" &&
    typeof value.callId === "string" &&
    typeof value.toolName === "string" &&
    (value.status === "requested" ||
      value.status === "running" ||
      value.status === "succeeded" ||
      value.status === "failed" ||
      value.status === "cancelled") &&
    isRecord(value.arguments) &&
    typeof value.createdAt === "string"
  );
}

function isError(value: unknown): value is AgentChatError {
  if (!isRecord(value)) return false;
  return (
    value.kind === "error" &&
    typeof value.id === "string" &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean" &&
    typeof value.createdAt === "string"
  );
}

function normalizeInterrupted(entry: AgentChatEntry): AgentChatEntry {
  if (entry.kind === "message" && entry.status === "streaming") {
    return { ...entry, status: "cancelled" };
  }
  if (
    entry.kind === "tool" &&
    (entry.status === "requested" || entry.status === "running")
  ) {
    return { ...entry, status: "cancelled" };
  }
  return entry;
}

export function parseStoredChat(raw: string | null): AgentChatEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredChatV2>;
    if (parsed.version !== 2 || !Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .filter(
        (entry): entry is AgentChatEntry =>
          isMessage(entry) || isTool(entry) || isError(entry),
      )
      .map(normalizeInterrupted)
      .slice(-MAX_PERSISTED_ENTRIES);
  } catch {
    return [];
  }
}

export function migrateLegacyChat(raw: string | null): AgentChatEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<StoredChatV1>;
    if (parsed.version !== 1 || !Array.isArray(parsed.messages)) return [];
    return parsed.messages
      .filter(isMessage)
      .map(normalizeInterrupted)
      .slice(-MAX_PERSISTED_ENTRIES);
  } catch {
    return [];
  }
}

export function serializeStoredChat(entries: AgentChatEntry[]): string {
  const sanitized = entries
    .slice(-MAX_PERSISTED_ENTRIES)
    .map((entry): AgentChatEntry => {
      if (entry.kind !== "tool") return entry;
      return {
        ...entry,
        arguments: safeJsonValue(entry.arguments) as Record<string, unknown>,
        result: safeJsonValue(entry.result),
      };
    });
  const stored: StoredChatV2 = { version: 2, entries: sanitized };
  return JSON.stringify(stored);
}

export function loadChatEntries(storage: Storage): AgentChatEntry[] {
  const current = parseStoredChat(storage.getItem(CHAT_STORAGE_KEY));
  if (current.length > 0 || storage.getItem(CHAT_STORAGE_KEY)) return current;
  return migrateLegacyChat(storage.getItem(LEGACY_CHAT_STORAGE_KEY));
}

export function createAgentEntryId(prefix = "chat"): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}
