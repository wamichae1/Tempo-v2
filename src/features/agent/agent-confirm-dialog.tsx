import { Bot } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PendingConfirmation } from "@/features/agent/use-agent-tools";

/**
 * Modal confirmation for destructive agent-initiated actions. The pending
 * tool call stays open until the user responds (or the request times out).
 */
export function AgentConfirmDialog({
  confirmation,
}: {
  confirmation: PendingConfirmation;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="alertdialog"
      aria-modal="true"
      aria-label={confirmation.title}
    >
      <div className="bg-card w-80 rounded-lg border p-4 shadow-sm">
        <div className="mb-2 flex items-center gap-2">
          <Bot className="text-muted-foreground size-4" />
          <h2 className="text-sm font-semibold">{confirmation.title}</h2>
        </div>
        <p className="text-muted-foreground mb-4 text-xs">
          {confirmation.body}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={confirmation.decline}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={confirmation.approve}
          >
            {confirmation.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
