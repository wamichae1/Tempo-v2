import { useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AgentToolsState } from "@/features/agent/use-agent-tools";
import { listRegisteredTools } from "@/features/agent/webmcp";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
}

let messageId = 0;
function nextMessageId() {
  messageId += 1;
  return messageId;
}

/**
 * First-class AI assistant panel.
 *
 * v1 is a UI shell: messages + composer with a stub responder, plus the
 * "Agent Link" section (WebMCP status, registered tools, destructive-action
 * confirmation toggle). A real AI backend will plug in behind the same
 * send() path and drive Tempo through the WebMCP tools listed here — never
 * by mutating calendar state directly.
 */
export function AssistantPanel({ agent }: { agent: AgentToolsState }) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: nextMessageId(),
      role: "assistant",
      text: agent.supported
        ? "Hi! I'm your Tempo assistant. I can see this calendar through WebMCP. Ask me to schedule, move, or find events — once I'm connected to a model, I'll act on the calendar directly."
        : "Hi! I'm your Tempo assistant. This browser doesn't expose WebMCP, so I can chat but can't act on the calendar yet.",
    },
  ]);
  const [input, setInput] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent.supported) return;
    let cancelled = false;
    void listRegisteredTools().then((registered) => {
      if (!cancelled && registered.length > 0) {
        setTools(registered.map((t) => t.name));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [agent.supported]);

  // Auto-scroll to the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    if (composerRef.current) composerRef.current.style.height = "auto";
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: "user", text },
    ]);
    // Stub responder — replaced by a real model client later.
    window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: "assistant",
          text: "I'm not connected to a model yet. When I am, I'll handle requests like this through Tempo's WebMCP tools and update the calendar for you.",
        },
      ]);
    }, 400);
  };

  const autoResize = () => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const visibleTools = tools.length > 0 ? tools : agent.toolNames;

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="text-muted-foreground size-3.5" />
        <span className="text-xs font-semibold">AI Assistant</span>
        <span
          className={cn(
            "ml-auto size-1.5 rounded-full",
            agent.supported ? "bg-event-green-border" : "bg-muted-foreground/50",
          )}
          title={agent.supported ? "WebMCP connected" : "WebMCP unavailable"}
        />
      </div>

      <div className="shrink-0 border-b px-3 py-2">
        <span className="label-mono text-muted-foreground">Agent Link</span>
        {agent.supported ? (
          <>
            <div className="mt-1.5 max-h-24 overflow-y-auto rounded-md border p-1.5">
              {visibleTools.length === 0 ? (
                <p className="text-muted-foreground px-1 text-[11px]">
                  No tools registered yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {visibleTools.map((name) => (
                    <li
                      key={name}
                      className="text-muted-foreground font-mono text-[11px]"
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <label className="mt-1.5 flex items-center gap-2 text-[11px]">
              <input
                type="checkbox"
                className="size-3.5 accent-current"
                checked={agent.confirmationsEnabled}
                onChange={(e) =>
                  agent.setConfirmationsEnabled(e.target.checked)
                }
              />
              Confirm destructive agent actions
            </label>
          </>
        ) : (
          <p className="text-muted-foreground mt-1 text-[11px]">
            This browser does not support WebMCP (document.modelContext).
          </p>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "max-w-[92%] rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed",
              message.role === "user"
                ? "bg-secondary self-end"
                : "bg-card self-start",
            )}
          >
            {message.text}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t p-2">
        <div className="bg-card focus-within:ring-ring/40 flex items-end gap-1.5 rounded-lg border p-1.5 focus-within:ring-2">
          <textarea
            ref={composerRef}
            rows={1}
            value={input}
            placeholder="Ask Tempo…"
            className="max-h-30 min-h-6 flex-1 resize-none bg-transparent px-1.5 py-0.5 text-xs outline-none placeholder:text-muted-foreground"
            onChange={(e) => {
              setInput(e.target.value);
              autoResize();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <Button
            variant="default"
            size="icon"
            className="size-7 shrink-0"
            onClick={send}
            disabled={!input.trim()}
            title="Send"
            aria-label="Send message"
          >
            <CornerDownLeft className="size-3.5" />
          </Button>
        </div>
        <p className="text-muted-foreground mt-1 flex items-center gap-1 px-1 text-[10px]">
          <Bot className="size-3" />
          Voice input coming soon
        </p>
      </div>
    </div>
  );
}
