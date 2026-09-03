import { CalendarDays, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";

export interface WorkspaceTabsProps {
  /** Whether the assistant panel is currently open. */
  assistantOpen: boolean;
  onToggleAssistant: () => void;
}

/**
 * VS Code-style tab strip above the center workspace. v1 has a fixed
 * "Calendar" tab plus an "AI Assistant" tab that opens/focuses the right
 * panel; full multi-tab management is intentionally deferred.
 */
export function WorkspaceTabs({
  assistantOpen,
  onToggleAssistant,
}: WorkspaceTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Workspace views"
      className="bg-background flex h-9 shrink-0 items-stretch gap-px overflow-x-auto border-b"
    >
      <button
        type="button"
        role="tab"
        aria-selected="true"
        className={cn(
          "text-foreground border-primary/60 flex items-center gap-1.5 border-t-2 px-3 text-xs font-medium",
          "bg-background",
        )}
      >
        <CalendarDays className="size-3.5" />
        Calendar
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={assistantOpen}
        onClick={onToggleAssistant}
        className={cn(
          "text-muted-foreground hover:text-foreground hover:bg-accent/50 flex items-center gap-1.5 border-t-2 border-transparent px-3 text-xs font-medium transition-colors",
          assistantOpen && "text-foreground border-primary/60",
        )}
      >
        <Sparkles className="size-3.5" />
        AI Assistant
      </button>
    </div>
  );
}
