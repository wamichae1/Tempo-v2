import { useEffect } from "react";

import type { CalendarEvent } from "@/components/calendar";
import type { EventClipboard } from "@/features/calendar/use-calendar-events";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export interface CalendarShortcutsOptions {
  undo: () => void;
  redo: () => void;
  selectedEvent: CalendarEvent | undefined;
  copyEvent: (event: CalendarEvent) => void;
  duplicateEvent: (event: CalendarEvent) => void;
  clipboard: EventClipboard | null;
  /** Paste at the selected event's start (or current date when nothing selected). */
  paste: () => void;
  /** Toggle the left sidebar (Ctrl/Cmd+B). */
  toggleSidebar: () => void;
  /** Toggle the Tempo Agent panel (Ctrl/Cmd+J). */
  toggleAssistant: () => void;
}

/**
 * Global keyboard shortcuts: undo/redo, copy/paste/duplicate, and workspace
 * panel toggles (Ctrl/Cmd+B sidebar, Ctrl/Cmd+J assistant).
 */
export function useCalendarShortcuts({
  undo,
  redo,
  selectedEvent,
  copyEvent,
  duplicateEvent,
  clipboard,
  paste,
  toggleSidebar,
  toggleAssistant,
}: CalendarShortcutsOptions) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

      if (key === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (key === "j") {
        e.preventDefault();
        toggleAssistant();
        return;
      }

      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if (isTypingTarget(e.target)) return;

      if (key === "c" && selectedEvent) {
        e.preventDefault();
        copyEvent(selectedEvent);
      } else if (key === "d" && selectedEvent) {
        e.preventDefault();
        duplicateEvent(selectedEvent);
      } else if (key === "v" && clipboard) {
        e.preventDefault();
        paste();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    undo,
    redo,
    selectedEvent,
    copyEvent,
    duplicateEvent,
    clipboard,
    paste,
    toggleSidebar,
    toggleAssistant,
  ]);
}
