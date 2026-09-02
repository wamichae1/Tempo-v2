import { useEffect, useState } from "react";
import { Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AgentToolsState } from "@/features/agent/use-agent-tools";
import { listRegisteredTools } from "@/features/agent/webmcp";

/**
 * "Agent Link" panel: shows WebMCP support status, the tools currently
 * exposed to agents, and the confirmation toggle for destructive actions.
 */
export function AgentPanel({ agent }: { agent: AgentToolsState }) {
  const [open, setOpen] = useState(false);
  const [queriedTools, setQueriedTools] = useState<string[]>([]);

  useEffect(() => {
    if (!open || !agent.supported) return;
    let cancelled = false;
    void listRegisteredTools().then((tools) => {
      if (!cancelled && tools.length > 0) {
        setQueriedTools(tools.map((t) => t.name));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, agent.supported]);

  // Prefer the live getTools() listing; fall back to registration results.
  const visibleTools = queriedTools.length > 0 ? queriedTools : agent.toolNames;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          title="Agent Link"
          aria-label="Agent Link"
        >
          <Bot className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Bot className="text-muted-foreground size-4" />
            <span className="text-sm font-medium">Agent Link</span>
          </div>

          {agent.supported ? (
            <>
              <p className="text-muted-foreground text-xs">
                WebMCP is available. An agent connected to this page can use
                the tools below.
              </p>
              <div className="max-h-40 overflow-y-auto rounded-md border p-1.5">
                {visibleTools.length === 0 ? (
                  <p className="text-muted-foreground px-1 text-xs">
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
              <label className="flex items-center gap-2 text-xs">
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
            <p className="text-muted-foreground text-xs">
              This browser does not support WebMCP
              (document.modelContext). Use a WebMCP-enabled browser to let an
              agent control Tempo.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
