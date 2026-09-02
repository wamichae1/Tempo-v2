import { useCallback, useEffect, useRef, useState } from "react";

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

  const confirm = useCallback((request: ConfirmRequest): Promise<boolean> => {
    if (!confirmationsRef.current) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => {
        pendingResolveRef.current = null;
        setPending(null);
        resolve(false);
      }, CONFIRM_TIMEOUT_MS);
      pendingResolveRef.current = (approved) => {
        window.clearTimeout(timeout);
        pendingResolveRef.current = null;
        setPending(null);
        resolve(approved);
      };
      setPending({ request, resolve: pendingResolveRef.current });
    });
  }, []);

  useEffect(() => {
    if (!supported) return;
    const controller = new AbortController();
    const tools = buildAgentTools({
      get store() {
        return storeRef.current;
      },
      confirm,
    });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

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
  };
}

/** Re-exported for the Agent panel's tool list refresh. */
export { listRegisteredTools };
