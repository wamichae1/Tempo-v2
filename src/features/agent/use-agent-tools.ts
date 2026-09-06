import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentTool } from "@/features/agent/agent-tool";
import type { CalendarEventsStore } from "@/features/calendar/use-calendar-events";
import {
  buildAgentTools,
  type ConfirmRequest,
} from "@/features/agent/agent-handlers";
import {
  isWebMcpSupported,
  listRegisteredTools,
  registerTools,
} from "@/features/agent/webmcp";

const LS_CONFIRM = "tempo:agent-confirm";
/** Auto-decline destructive actions if the user doesn't respond in time. */
const CONFIRM_TIMEOUT_MS = 60_000;

export interface PendingConfirmation extends ConfirmRequest {
  approve: () => void;
  decline: () => void;
}

export interface AgentToolsState {
  /** Whether this browser exposes document.modelContext. */
  supported: boolean;
  /** Names of tools that registered successfully. */
  toolNames: string[];
  /** Whether destructive agent actions require in-app confirmation. */
  confirmationsEnabled: boolean;
  setConfirmationsEnabled: (enabled: boolean) => void;
  /** A confirmation request currently waiting on the user, if any. */
  pendingConfirmation: PendingConfirmation | null;
  /** Shared tools used by both WebMCP and built-in Tempo Chat. */
  tools: readonly AgentTool[];
}

/**
 * Registers Tempo's WebMCP tools for the lifetime of the calendar component.
 *
 * Tool execute callbacks read the store through a ref so they always see the
 * latest calendars/events, even though registration happens once on mount.
 * Unregistration happens via AbortController on unmount.
 */
export function useAgentTools(store: CalendarEventsStore): AgentToolsState {
  const [supported] = useState(isWebMcpSupported);
  const [toolNames, setToolNames] = useState<string[]>([]);
  const [confirmationsEnabled, setConfirmationsEnabledState] = useState(
    () => localStorage.getItem(LS_CONFIRM) !== "off",
  );
  const [pending, setPending] = useState<{
    request: ConfirmRequest;
    resolve: (approved: boolean) => void;
  } | null>(null);

  const storeRef = useRef(store);
  const confirmationsRef = useRef(confirmationsEnabled);
  const pendingResolveRef = useRef<((approved: boolean) => void) | null>(null);

  // Keep refs current so long-lived tool callbacks see the latest values.
  useEffect(() => {
    storeRef.current = store;
  }, [store]);
  useEffect(() => {
    confirmationsRef.current = confirmationsEnabled;
  }, [confirmationsEnabled]);

  const confirm = useCallback(
    (request: ConfirmRequest, signal?: AbortSignal): Promise<boolean> => {
      if (!confirmationsRef.current) return Promise.resolve(true);
      if (signal?.aborted) return Promise.resolve(false);
      // Tempo supports one confirmation at a time. A newer request safely
      // declines any older pending request.
      pendingResolveRef.current?.(false);
      return new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (approved: boolean) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          signal?.removeEventListener("abort", handleAbort);
          if (pendingResolveRef.current === finish) {
            pendingResolveRef.current = null;
            setPending(null);
          }
          resolve(approved);
        };
        const handleAbort = () => finish(false);
        const timeout = window.setTimeout(
          () => finish(false),
          CONFIRM_TIMEOUT_MS,
        );
        signal?.addEventListener("abort", handleAbort, { once: true });
        pendingResolveRef.current = finish;
        setPending({ request, resolve: finish });
      });
    },
    [],
  );

  const getStore = useCallback(() => storeRef.current, []);
  // The returned tool callbacks retain getStore without invoking it during
  // render; the ref is only read later when a tool executes.
  const tools = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => buildAgentTools({ getStore, confirm }),
    [confirm, getStore],
  );

  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    registerTools(tools, controller.signal)
      .then((names) => {
        if (!controller.signal.aborted) setToolNames(names);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      // Auto-decline any pending confirmation on unmount.
      pendingResolveRef.current?.(false);
    };
  }, [supported, tools]);

  const setConfirmationsEnabled = useCallback((enabled: boolean) => {
    setConfirmationsEnabledState(enabled);
    try {
      localStorage.setItem(LS_CONFIRM, enabled ? "on" : "off");
    } catch {
      // storage unavailable — keep in memory
    }
  }, []);

  const pendingConfirmation: PendingConfirmation | null = pending
    ? {
        ...pending.request,
        approve: () => pending.resolve(true),
        decline: () => pending.resolve(false),
      }
    : null;

  return {
    supported,
    toolNames,
    confirmationsEnabled,
    setConfirmationsEnabled,
    pendingConfirmation,
    tools,
  };
}

/** Re-exported for the Agent panel's tool list refresh. */
export { listRegisteredTools };
