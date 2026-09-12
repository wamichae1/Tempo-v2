import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

/**
 * Minimal Vercel-style modal dialog used for lightweight confirmations and
 * pickers (delete calendar, ICS import destination, ...).
 *
 * Visual language: Geist type, 6px radius, hairline border, flat surface,
 * no heavy shadow. Keyboard accessible: Escape cancels, focus is trapped
 * inside the panel while open, and the first focusable control receives
 * initial focus.
 */
export function TempoDialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
  widthClass = "w-[320px]",
  role = "alertdialog",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  widthClass?: string;
  role?: "dialog" | "alertdialog";
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      // Simple focus trap within the panel.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    // Initial focus: first focusable element inside the panel.
    const id = requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      cancelAnimationFrame(id);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-label={title}
        className={cn(
          "rounded-[6px] border border-border bg-popover p-4 text-popover-foreground",
          widthClass,
          className,
        )}
      >
        <h2 className="text-sm font-semibold">{title}</h2>
        {description && (
          <p className="text-muted-foreground mt-1 text-xs">{description}</p>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
