import { useEffect, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";

import { AgentChat } from "@/features/agent/agent-chat";
import { useAgentChat } from "@/features/agent/use-agent-chat";
import { useAiSettings } from "@/features/agent/use-ai-settings";
import type { AgentToolsState } from "@/features/agent/use-agent-tools";
import { WebMcpInspector } from "@/features/agent/webmcp-inspector";
import { cn } from "@/lib/utils";

const MODE_STORAGE_KEY = "tempo:agent-mode";

type AgentPanelMode = "chat" | "webmcp";

function loadMode(): AgentPanelMode {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === "webmcp"
      ? "webmcp"
      : "chat";
  } catch {
    return "chat";
  }
}

/**
 * Home for Tempo's built-in agent experience and its existing WebMCP
 * inspector. Switching views never affects WebMCP registration or execution.
 */
export function AgentPanel({
  agent,
  onClose,
  chatModeRequest,
  openSettingsRequest,
  onOpenWebMcpGuide,
}: {
  agent: AgentToolsState;
  onClose?: () => void;
  /** When this nonce changes, switch to the Chat tab. */
  chatModeRequest?: number;
  /** When this nonce changes, open the Agent settings dialog. */
  openSettingsRequest?: number;
  /** Opens the existing WebMCP setup guide. */
  onOpenWebMcpGuide?: () => void;
}) {
  const [mode, setMode] = useState<AgentPanelMode>(loadMode);
  const settings = useAiSettings();
  const chat = useAgentChat({ tools: agent.tools, settings });
  const chatTabRef = useRef<HTMLButtonElement>(null);
  const webMcpTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable - keep the selection in memory.
    }
  }, [mode]);

  const selectTab = (next: AgentPanelMode) => {
    setMode(next);
    requestAnimationFrame(() => {
      (next === "chat" ? chatTabRef : webMcpTabRef).current?.focus();
    });
  };

  const lastChatModeRequest = useRef(chatModeRequest ?? 0);
  useEffect(() => {
    if ((chatModeRequest ?? 0) !== lastChatModeRequest.current) {
      lastChatModeRequest.current = chatModeRequest ?? 0;
      setMode("chat");
    }
  }, [chatModeRequest]);

  return (
    <div
      className="bg-background flex h-full min-h-0 flex-col"
      data-tour="agent-panel"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="text-muted-foreground size-3.5" />
        <span className="text-xs font-semibold">Tempo Agent</span>
        <button
          type="button"
          onClick={onClose}
          title="Close Tempo Agent"
          aria-label="Close Tempo Agent"
          className="hover:bg-accent text-muted-foreground hover:text-foreground ml-auto flex size-6 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Tempo Agent views"
        className="flex h-9 shrink-0 items-center gap-1 border-b px-2"
      >
        <button
          ref={chatTabRef}
          id="tempo-agent-chat-tab"
          type="button"
          role="tab"
          aria-selected={mode === "chat"}
          aria-controls="tempo-agent-chat-panel"
          tabIndex={mode === "chat" ? 0 : -1}
          onClick={() => setMode("chat")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              selectTab("webmcp");
            }
          }}
          className={cn(
            "h-6 rounded-sm px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2",
            mode === "chat"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          Chat
        </button>
        <button
          ref={webMcpTabRef}
          id="tempo-agent-webmcp-tab"
          type="button"
          role="tab"
          aria-selected={mode === "webmcp"}
          aria-controls="tempo-agent-webmcp-panel"
          tabIndex={mode === "webmcp" ? 0 : -1}
          onClick={() => setMode("webmcp")}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              selectTab("chat");
            }
          }}
          className={cn(
            "flex h-6 items-center gap-1.5 rounded-sm px-2 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2",
            mode === "webmcp"
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
          )}
        >
          WebMCP
          <span
            className={cn(
              "size-1.5 rounded-full",
              agent.supported
                ? "bg-event-green-border"
                : "bg-muted-foreground/50",
            )}
            title={agent.supported ? "WebMCP available" : "WebMCP unavailable"}
          />
        </button>
      </div>

      <div
        id="tempo-agent-chat-panel"
        role="tabpanel"
        aria-labelledby="tempo-agent-chat-tab"
        hidden={mode !== "chat"}
        className={cn("min-h-0 flex-1", mode !== "chat" && "hidden")}
      >
        <AgentChat
          chat={chat}
          settings={settings}
          confirmationsEnabled={agent.confirmationsEnabled}
          onConfirmationsEnabledChange={agent.setConfirmationsEnabled}
          openSettingsRequest={openSettingsRequest}
        />
      </div>
      <div
        id="tempo-agent-webmcp-panel"
        role="tabpanel"
        aria-labelledby="tempo-agent-webmcp-tab"
        hidden={mode !== "webmcp"}
        className={cn("min-h-0 flex-1", mode !== "webmcp" && "hidden")}
      >
        <WebMcpInspector
          agent={agent}
          onOpenWebMcpGuide={onOpenWebMcpGuide}
        />
      </div>
    </div>
  );
}
