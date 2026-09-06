import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentTool } from "@/features/agent/agent-tool";
import {
  CHAT_STORAGE_KEY,
  LEGACY_CHAT_STORAGE_KEY,
  MAX_PERSISTED_ENTRIES,
  containsConfiguredSecret,
  createAgentEntryId,
  loadChatEntries,
  redactConfiguredSecrets,
  sanitizeChatValue,
  serializeStoredChat,
  type AgentChatEntry,
  type AgentChatMessage,
  type AgentChatToolActivity,
  type AgentErrorCode,
} from "@/features/agent/agent-chat-state";
import { runAgentTurn } from "@/features/agent/agent-runtime";
import { buildAgentSystemPrompt } from "@/features/agent/agent-system-prompt";
import { AiProviderError } from "@/features/agent/ai/ai-provider";
import { createAiProvider } from "@/features/agent/ai/provider-registry";
import type { AiSettingsState } from "@/features/agent/use-ai-settings";

export type {
  AgentChatEntry,
  AgentChatMessage,
  AgentChatToolActivity,
} from "@/features/agent/agent-chat-state";

export type AgentChatRuntimeStatus =
  | "idle"
  | "requesting"
  | "streaming"
  | "executing-tool"
  | "cancelling";

export interface AgentChatState {
  entries: AgentChatEntry[];
  draft: string;
  setDraft: (text: string) => void;
  submitDraft: () => boolean;
  cancelRun: () => void;
  retryLast: () => void;
  clearConversation: () => void;
  runtimeStatus: AgentChatRuntimeStatus;
  configured: boolean;
  isRunning: boolean;
}

function capEntries(entries: AgentChatEntry[]): AgentChatEntry[] {
  return entries.slice(-MAX_PERSISTED_ENTRIES);
}

function toConversation(entries: AgentChatEntry[]) {
  return entries.flatMap((entry) => {
    if (entry.kind !== "message" || entry.status === "error") return [];
    if (!entry.text.trim()) return [];
    return [{ role: entry.role, text: entry.text }] as const;
  });
}

function friendlyUnexpectedError(): {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
} {
  return {
    code: "unknown",
    message: "Tempo Agent encountered an unexpected error.",
    retryable: true,
  };
}

export function useAgentChat({
  tools,
  settings,
}: {
  tools: readonly AgentTool[];
  settings: AiSettingsState;
}): AgentChatState {
  const [entries, setEntries] = useState<AgentChatEntry[]>(() => {
    try {
      return loadChatEntries(localStorage);
    } catch {
      return [];
    }
  });
  const [draft, setDraft] = useState("");
  const [runtimeStatus, setRuntimeStatus] =
    useState<AgentChatRuntimeStatus>("idle");
  const activeRunRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      if (entries.length === 0) {
        localStorage.removeItem(CHAT_STORAGE_KEY);
        return;
      }
      const serialized = serializeStoredChat(entries, settings.configuredKeys);
      localStorage.setItem(CHAT_STORAGE_KEY, serialized);
      localStorage.removeItem(LEGACY_CHAT_STORAGE_KEY);
    } catch {
      // Storage unavailable or full - keep the conversation in memory.
    }
  }, [entries, settings.configuredKeys]);

  useEffect(
    () => () => {
      activeRunRef.current?.abort();
    },
    [],
  );

  const submitDraft = useCallback((): boolean => {
    const text = draft.trim();
    if (!text || activeRunRef.current || !settings.configured) return false;
    if (containsConfiguredSecret(text, settings.configuredKeys)) {
      setEntries((current) =>
        capEntries([
          ...current,
          {
            kind: "error",
            id: createAgentEntryId("error"),
            code: "missing-key",
            message:
              "Remove API keys from the message before sending. Tempo never places configured keys in the transcript.",
            retryable: false,
            createdAt: new Date().toISOString(),
          },
        ]),
      );
      return false;
    }

    const userMessage: AgentChatMessage = {
      kind: "message",
      id: createAgentEntryId("message"),
      role: "user",
      text,
      status: "complete",
      createdAt: new Date().toISOString(),
    };
    const conversationEntries = capEntries([...entries, userMessage]);
    setEntries(conversationEntries);
    setDraft("");

    const controller = new AbortController();
    activeRunRef.current = controller;
    setRuntimeStatus("requesting");
    const assistantByRound = new Map<number, string>();
    const toolEntryByCall = new Map<string, string>();

    void runAgentTurn({
      provider: createAiProvider(settings.provider),
      config: {
        provider: settings.provider,
        apiKey: settings.apiKey.trim(),
        model: settings.model.trim(),
      },
      systemPrompt: buildAgentSystemPrompt(),
      conversation: toConversation(conversationEntries),
      tools,
      signal: controller.signal,
      callbacks: {
        onRoundStart: (round) => {
          const id = createAgentEntryId("assistant");
          assistantByRound.set(round, id);
          const message: AgentChatMessage = {
            kind: "message",
            id,
            role: "assistant",
            text: "",
            status: "streaming",
            createdAt: new Date().toISOString(),
          };
          setEntries((current) => capEntries([...current, message]));
          setRuntimeStatus("requesting");
        },
        onTextDelta: (delta, round) => {
          const id = assistantByRound.get(round);
          if (!id) return;
          setRuntimeStatus("streaming");
          const safeDelta = redactConfiguredSecrets(
            delta,
            settings.configuredKeys,
          );
          setEntries((current) =>
            current.map((entry) =>
              entry.kind === "message" && entry.id === id
                ? { ...entry, text: entry.text + safeDelta }
                : entry,
            ),
          );
        },
        onRoundComplete: (finalText, round, hasToolCalls) => {
          const id = assistantByRound.get(round);
          if (!id) return;
          setEntries((current) => {
            if (!finalText.trim() && hasToolCalls) {
              return current.filter((entry) => entry.id !== id);
            }
            return current.map((entry) =>
              entry.kind === "message" && entry.id === id
                ? {
                    ...entry,
                    text:
                      redactConfiguredSecrets(
                        finalText,
                        settings.configuredKeys,
                      ).trim() || "No response.",
                    status: "complete",
                  }
                : entry,
            );
          });
        },
        onToolStart: (call, argumentsValue) => {
          const id = createAgentEntryId("tool");
          toolEntryByCall.set(call.callId, id);
          const activity: AgentChatToolActivity = {
            kind: "tool",
            id,
            callId: call.callId,
            toolName: call.name,
            status: "running",
            arguments: sanitizeChatValue(
              argumentsValue,
              settings.configuredKeys,
            ) as Record<string, unknown>,
            createdAt: new Date().toISOString(),
          };
          setRuntimeStatus("executing-tool");
          setEntries((current) => capEntries([...current, activity]));
        },
        onToolComplete: (call, _argumentsValue, result, succeeded) => {
          const id = toolEntryByCall.get(call.callId);
          if (!id) return;
          setEntries((current) =>
            current.map((entry) =>
              entry.kind === "tool" && entry.id === id
                ? {
                    ...entry,
                    status: succeeded ? "succeeded" : "failed",
                    result: sanitizeChatValue(
                      result,
                      settings.configuredKeys,
                    ),
                  }
                : entry,
            ),
          );
        },
      },
    })
      .catch((error: unknown) => {
        const detail =
          error instanceof AiProviderError
            ? {
                code: error.code,
                message: error.message,
                retryable: error.retryable,
              }
            : friendlyUnexpectedError();
        const cancelled =
          detail.code === "cancelled" || controller.signal.aborted;
        setEntries((current) => {
          const normalized = current.map((entry): AgentChatEntry => {
            if (entry.kind === "message" && entry.status === "streaming") {
              return {
                ...entry,
                text: entry.text || (cancelled ? "Cancelled." : ""),
                status: cancelled ? "cancelled" : "error",
              };
            }
            if (entry.kind === "tool" && entry.status === "running") {
              return { ...entry, status: "cancelled" };
            }
            return entry;
          });
          if (cancelled) return normalized;
          return capEntries([
            ...normalized,
            {
              kind: "error",
              id: createAgentEntryId("error"),
              code: detail.code,
                message: redactConfiguredSecrets(
                  detail.message,
                  settings.configuredKeys,
                ),
              retryable: detail.retryable,
              createdAt: new Date().toISOString(),
            },
          ]);
        });
      })
      .finally(() => {
        if (activeRunRef.current === controller) {
          activeRunRef.current = null;
          setRuntimeStatus("idle");
        }
      });

    return true;
  }, [draft, entries, settings, tools]);

  const cancelRun = useCallback(() => {
    if (!activeRunRef.current) return;
    setRuntimeStatus("cancelling");
    activeRunRef.current.abort();
  }, []);

  const retryLast = useCallback(() => {
    const lastUser = [...entries]
      .reverse()
      .find(
        (entry): entry is AgentChatMessage =>
          entry.kind === "message" && entry.role === "user",
      );
    if (lastUser) setDraft(lastUser.text);
  }, [entries]);

  const clearConversation = useCallback(() => {
    activeRunRef.current?.abort();
    setEntries([]);
    setDraft("");
    setRuntimeStatus("idle");
  }, []);

  return {
    entries,
    draft,
    setDraft,
    submitDraft,
    cancelRun,
    retryLast,
    clearConversation,
    runtimeStatus,
    configured: settings.configured,
    isRunning: runtimeStatus !== "idle",
  };
}
