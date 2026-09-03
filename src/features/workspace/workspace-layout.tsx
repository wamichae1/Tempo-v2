import { useEffect } from "react";
import {
  Group,
  Panel,
  Separator,
  useDefaultLayout,
  usePanelRef,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

export interface WorkspaceLayoutProps {
  /** Left region (calendars / navigation). */
  sidebar: React.ReactNode;
  /** Right region (AI assistant). */
  assistant: React.ReactNode;
  /** Center workspace content. */
  children: React.ReactNode;
  sidebarCollapsed: boolean;
  assistantCollapsed: boolean;
  onSidebarCollapsedChange: (collapsed: boolean) => void;
  onAssistantCollapsedChange: (collapsed: boolean) => void;
}

const separatorClass =
  "bg-border w-px shrink-0 transition-colors data-[separator]:hover:bg-muted-foreground/40";

/**
 * VS Code-style three-region workspace: collapsible/resizable sidebar and
 * assistant panel flanking the center content. Panel sizes persist to
 * localStorage; collapse state is controlled by the parent so header buttons
 * and keyboard shortcuts stay in sync with sash drags.
 */
export function WorkspaceLayout({
  sidebar,
  assistant,
  children,
  sidebarCollapsed,
  assistantCollapsed,
  onSidebarCollapsedChange,
  onAssistantCollapsedChange,
}: WorkspaceLayoutProps) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "tempo:layout",
    panelIds: ["sidebar", "center", "assistant"],
    storage: localStorage,
  });
  const sidebarRef = usePanelRef();
  const assistantRef = usePanelRef();

  useEffect(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (sidebarCollapsed) panel.collapse();
    else panel.expand();
  }, [sidebarCollapsed, sidebarRef]);

  useEffect(() => {
    const panel = assistantRef.current;
    if (!panel) return;
    if (assistantCollapsed) panel.collapse();
    else panel.expand();
  }, [assistantCollapsed, assistantRef]);

  return (
    <Group
      orientation="horizontal"
      className="min-h-0 flex-1"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel
        id="sidebar"
        collapsible
        collapsedSize={0}
        defaultSize="15%"
        minSize="200px"
        maxSize="30%"
        panelRef={sidebarRef}
        onResize={(size) =>
          onSidebarCollapsedChange(size.inPixels < 1)
        }
        className="min-h-0 overflow-hidden"
      >
        {/* Keep children mounted (preserve component state) but fully hidden
            when collapsed — a zero-width panel still leaks child padding. */}
        <div className={cn("h-full min-h-0", sidebarCollapsed && "hidden")}>
          {sidebar}
        </div>
      </Panel>
      <Separator className={separatorClass} />
      <Panel id="center" minSize="30%" className="flex min-h-0 min-w-0 flex-col">
        {children}
      </Panel>
      <Separator className={separatorClass} />
      <Panel
        id="assistant"
        collapsible
        collapsedSize={0}
        defaultSize="22%"
        minSize="280px"
        maxSize="40%"
        panelRef={assistantRef}
        onResize={(size) =>
          onAssistantCollapsedChange(size.inPixels < 1)
        }
        className="min-h-0 overflow-hidden"
      >
        <div className={cn("h-full min-h-0", assistantCollapsed && "hidden")}>
          {assistant}
        </div>
      </Panel>
    </Group>
  );
}
