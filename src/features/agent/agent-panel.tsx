import { useState } from "react";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  getAgentToolMetadata,
  type AgentToolInfo,
  type AgentToolParam,
  type ToolSection,
} from "@/features/agent/agent-tool-metadata";
import type { AgentToolsState } from "@/features/agent/use-agent-tools";

const SECTION_ORDER: ToolSection[] = ["READ", "WRITE", "HISTORY"];

function ParamRow({
  param,
  depth = 0,
}: {
  param: AgentToolParam;
  depth?: number;
}) {
  return (
    <>
      <div
        className={cn(
          "grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 py-1",
          depth > 0 && "ml-3",
        )}
      >
        <div className="min-w-0">
          <span className="font-mono text-[11px]">{param.name}</span>
          {param.required ? (
            <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
              required
            </span>
          ) : (
            <span className="text-muted-foreground/70 ml-1.5 font-mono text-[10px]">
              optional
            </span>
          )}
        </div>
        <span className="text-muted-foreground font-mono text-[10px]">
          {param.type}
        </span>
        {param.description && (
          <p className="text-muted-foreground col-span-2 text-[11px] leading-snug">
            {param.description}
          </p>
        )}
      </div>
      {param.children?.map((child) => (
        <ParamRow key={child.name} param={child} depth={depth + 1} />
      ))}
    </>
  );
}

function ToolRow({
  tool,
  expanded,
  onToggle,
}: {
  tool: AgentToolInfo;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        title={tool.description}
        aria-expanded={expanded}
        className="hover:bg-secondary/60 flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-xs font-medium">{tool.title}</span>
          <span className="text-muted-foreground ml-auto shrink-0 font-mono text-[9px] tracking-wide">
            {tool.kind}
          </span>
          {tool.confirmationProtected && (
            <span className="text-muted-foreground shrink-0 font-mono text-[9px] tracking-wide">
              CONFIRM
            </span>
          )}
        </div>
        <span className="text-muted-foreground font-mono text-[10px]">
          {tool.name}
        </span>
        <span className="text-muted-foreground truncate text-[11px]">
          {tool.description}
        </span>
      </button>
      {expanded && (
        <div className="border-t px-2.5 py-1.5">
          <p className="text-muted-foreground mb-1 text-[11px] leading-snug">
            {tool.description}
          </p>
          {tool.confirmationProtected && (
            <p className="text-muted-foreground mb-1 text-[11px]">
              Requires in-app user confirmation when enabled.
            </p>
          )}
          <span className="label-mono text-muted-foreground">Parameters</span>
          {tool.params.length === 0 ? (
            <p className="text-muted-foreground py-1 text-[11px]">None</p>
          ) : (
            <div className="divide-border divide-y">
              {tool.params.map((param) => (
                <ParamRow key={param.name} param={param} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Tempo Agent panel: a read-only inspector for the WebMCP tools Tempo
 * exposes to external agents (e.g. ChatGPT). Tempo has no built-in model —
 * this panel only reports what an external agent can call. It never
 * executes tools or mutates calendar state.
 */
export function AgentPanel({ agent }: { agent: AgentToolsState }) {
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const tools = getAgentToolMetadata();

  return (
    <div className="bg-background flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <Sparkles className="text-muted-foreground size-3.5" />
        <span className="text-xs font-semibold">Tempo Agent</span>
        <span
          className={cn(
            "ml-auto size-1.5 rounded-full",
            agent.supported ? "bg-event-green-border" : "bg-muted-foreground/50",
          )}
          title={agent.supported ? "WebMCP available" : "WebMCP unavailable"}
        />
      </div>

      <div className="shrink-0 border-b px-3 py-2">
        <div className="flex items-baseline gap-2">
          <span className="label-mono text-muted-foreground">WebMCP</span>
          <span className="text-[11px] font-medium">
            {agent.supported ? "Available" : "Unavailable"}
          </span>
        </div>
        {agent.supported ? (
          <>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {tools.length} tools available to agents on this page.
            </p>
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
          <p className="text-muted-foreground mt-1 text-[11px] leading-snug">
            Tempo Agent tools are available when Tempo is opened in a
            compatible agent/browser environment.
          </p>
        )}
      </div>

      {agent.supported && (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
          <p className="text-muted-foreground text-[10px] leading-snug">
            Tools exposed to external agents (e.g. ChatGPT) on this page.
          </p>
          {SECTION_ORDER.map((section) => {
            const sectionTools = tools.filter((t) => t.section === section);
            if (sectionTools.length === 0) return null;
            return (
              <section key={section} aria-label={`${section} tools`}>
                <span className="label-mono text-muted-foreground">
                  {section}
                </span>
                <div className="mt-1 flex flex-col gap-1.5">
                  {sectionTools.map((tool) => (
                    <ToolRow
                      key={tool.name}
                      tool={tool}
                      expanded={expandedTool === tool.name}
                      onToggle={() =>
                        setExpandedTool((current) =>
                          current === tool.name ? null : tool.name,
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
