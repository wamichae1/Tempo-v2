import * as React from "react";
import {
  CalendarPlus,
  Check,
  Download,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CalendarEvent, EventColor } from "@/components/calendar";
import { createEventId } from "@/features/calendar/use-calendar-events";
import type { Calendar } from "@/features/calendar/types";
import { EVENT_COLORS, createCalendarId } from "@/features/calendar/types";
import { downloadICS, generateICS, parseICS } from "@/lib/ics";

const colorDotClass: Record<EventColor, string> = {
  red: "bg-event-red-border",
  orange: "bg-event-orange-border",
  yellow: "bg-event-yellow-border",
  green: "bg-event-green-border",
  blue: "bg-event-blue-border",
  purple: "bg-event-purple-border",
  gray: "bg-event-gray-border",
};

export interface CalendarSidebarProps {
  calendars: Calendar[];
  events: CalendarEvent[];
  addCalendar: (name: string, color: EventColor) => Calendar;
  updateCalendar: (calendar: Calendar) => void;
  deleteCalendar: (calendarId: string) => void;
  importEvents: (events: CalendarEvent[], calendarId: string) => void;
  className?: string;
}

/**
 * Left sidebar listing all calendars with create / rename / recolor /
 * show-hide / delete, plus ICS import and export.
 */
export function CalendarSidebar({
  calendars,
  events,
  addCalendar,
  updateCalendar,
  deleteCalendar,
  importEvents,
  className,
}: CalendarSidebarProps) {
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [notice, setNotice] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  /** Calendar chosen as the target for the next import (default: first). */
  const [importTargetId, setImportTargetId] = React.useState<string | null>(null);

  const eventCountByCalendar = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const e of events) {
      const id = e.calendarId ?? "";
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [events]);

  const commitCreate = () => {
    const name = newName.trim();
    if (name) {
      const color = EVENT_COLORS[calendars.length % EVENT_COLORS.length];
      addCalendar(name, color);
    }
    setNewName("");
    setCreating(false);
  };

  const commitRename = (calendar: Calendar) => {
    const name = renameValue.trim();
    if (name && name !== calendar.name) {
      updateCalendar({ ...calendar, name });
    }
    setRenamingId(null);
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseICS(text);
      if (parsed.events.length === 0) {
        setNotice("No events found in that file.");
        return;
      }
      const targetId = importTargetId ?? calendars[0]?.id;
      if (!targetId) return;
      const imported: CalendarEvent[] = parsed.events.map((e) => ({
        id: createEventId(),
        title: e.title,
        start: e.start,
        end: e.end,
        isAllDay: e.isAllDay,
        description: e.description,
        location: e.location,
        rrule: e.rrule,
        color: e.color ?? parsed.calendarColor,
        calendarId: targetId,
      }));
      importEvents(imported, targetId);
      const warn =
        parsed.warnings.length > 0 ? ` (${parsed.warnings.length} skipped/warnings)` : "";
      setNotice(`Imported ${imported.length} event${imported.length === 1 ? "" : "s"}${warn}.`);
    } catch {
      setNotice("Could not read that file.");
    }
  };

  const handleExport = (calendar?: Calendar) => {
    if (calendar) {
      const ics = generateICS(
        events.filter((e) => e.calendarId === calendar.id),
        { calendarName: calendar.name, calendarColor: calendar.color },
      );
      downloadICS(`${calendar.name.replace(/\s+/g, "-").toLowerCase()}.ics`, ics);
    } else {
      const byId = new Map(calendars.map((c) => [c.id, c]));
      const ics = generateICS(events, {
        calendarName: "Tempo",
        calendarResolver: (id) => (id ? byId.get(id) : undefined),
      });
      downloadICS("tempo-calendars.ics", ics);
    }
  };

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3",
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Calendars
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title="New calendar"
          onClick={() => setCreating(true)}
        >
          <CalendarPlus className="size-3.5" />
        </Button>
      </div>

      {calendars.map((calendar) => (
        <div key={calendar.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent">
          <input
            type="checkbox"
            className="size-3.5 shrink-0 accent-current"
            checked={calendar.visible}
            onChange={(e) =>
              updateCalendar({ ...calendar, visible: e.target.checked })
            }
            title={calendar.visible ? "Hide calendar" : "Show calendar"}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn("size-3 shrink-0 rounded-xs", colorDotClass[calendar.color])}
                title="Change color"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-0 p-1">
              <div className="flex gap-1.5 p-1">
                {EVENT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "flex size-4 items-center justify-center rounded-xs",
                      colorDotClass[color],
                    )}
                    onClick={() => updateCalendar({ ...calendar, color })}
                  >
                    {color === calendar.color && <Check className="size-2.5 text-white" />}
                  </button>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          {renamingId === calendar.id ? (
            <input
              autoFocus
              className="min-w-0 flex-1 rounded-sm border bg-transparent px-1 py-0.5 text-xs outline-none"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => commitRename(calendar)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(calendar);
                if (e.key === "Escape") setRenamingId(null);
              }}
            />
          ) : (
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                !calendar.visible && "text-muted-foreground line-through",
              )}
              onDoubleClick={() => {
                setRenamingId(calendar.id);
                setRenameValue(calendar.name);
              }}
              title={`${calendar.name} (${eventCountByCalendar.get(calendar.id) ?? 0} events) — double-click to rename`}
            >
              {calendar.name}
            </span>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-5 opacity-0 group-hover:opacity-100"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onSelect={() => {
                  setRenamingId(calendar.id);
                  setRenameValue(calendar.name);
                }}
              >
                <Pencil className="size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport(calendar)}>
                <Download className="size-3.5" /> Export .ics
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setImportTargetId(calendar.id);
                  fileInputRef.current?.click();
                }}
              >
                <Upload className="size-3.5" /> Import into this calendar…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => {
                  const count = eventCountByCalendar.get(calendar.id) ?? 0;
                  const ok =
                    count === 0 ||
                    window.confirm(
                      `Delete "${calendar.name}" and its ${count} event${count === 1 ? "" : "s"}?`,
                    );
                  if (ok) deleteCalendar(calendar.id);
                }}
              >
                <Trash2 className="size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}

      {creating && (
        <div className="flex items-center gap-2 px-1 py-1">
          <span className="size-3 shrink-0" />
          <input
            autoFocus
            placeholder="Calendar name"
            className="min-w-0 flex-1 rounded-sm border bg-transparent px-1 py-0.5 text-xs outline-none"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCreate();
              if (e.key === "Escape") {
                setNewName("");
                setCreating(false);
              }
            }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1 border-t pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-xs"
          onClick={() => {
            setImportTargetId(null);
            fileInputRef.current?.click();
          }}
        >
          <Upload className="size-3.5" /> Import .ics…
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-xs"
          onClick={() => handleExport()}
        >
          <Download className="size-3.5" /> Export all (.ics)
        </Button>
        {notice && (
          <p className="text-muted-foreground px-2 text-[11px]">{notice}</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImportFile(file);
          e.target.value = "";
        }}
      />
    </aside>
  );
}

// Re-export for convenience so callers don't need two imports.
export { createCalendarId };
