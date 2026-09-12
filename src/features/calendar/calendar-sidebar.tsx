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
import { TempoDialog } from "@/components/ui/tempo-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CalendarEvent, EventColor } from "@/components/calendar";
import type {
  CalendarEventImport,
  ImportEventsResult,
} from "@/features/calendar/use-calendar-events";
import type { Calendar } from "@/features/calendar/types";
import {
  EVENT_COLORS,
  EVENT_COLOR_DOT_CLASS,
  createCalendarId,
} from "@/features/calendar/types";
import { ICSImportDialog } from "@/features/calendar/ics-import-dialog";
import { downloadICS, generateICS } from "@/lib/ics";
import {
  MAX_ICS_FILE_BYTES,
  parseICSImport,
  type ICSImportParseResult,
} from "@/lib/ics-import";

const colorDotClass = EVENT_COLOR_DOT_CLASS;

export interface CalendarSidebarProps {
  calendars: Calendar[];
  events: CalendarEvent[];
  addCalendar: (name: string, color: EventColor) => Calendar;
  updateCalendar: (calendar: Calendar) => void;
  deleteCalendar: (calendarId: string) => void;
  importEvents: (
    events: CalendarEventImport[],
    calendarId: string,
  ) => ImportEventsResult;
  /** Optional mini month calendar rendered below the calendar list. */
  miniCalendar?: React.ReactNode;
  className?: string;
}

interface Toast {
  title: string;
  description?: string;
  variant: "default" | "error";
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
  miniCalendar,
  className,
}: CalendarSidebarProps) {
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [toast, setToast] = React.useState<Toast | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const importRequestRef = React.useRef(0);
  /** Explicit target supplied by "Import into this calendar". */
  const [importTargetId, setImportTargetId] = React.useState<string | null>(null);
  const [importDialog, setImportDialog] = React.useState<{
    open: boolean;
    fileName: string;
    loading: boolean;
    parsed: ICSImportParseResult | null;
    readError?: string;
  }>({
    open: false,
    fileName: "",
    loading: false,
    parsed: null,
  });
  /** Calendar id pending deletion confirmation (null = dialog closed). */
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);

  const pendingDeleteCalendar = pendingDeleteId
    ? calendars.find((c) => c.id === pendingDeleteId)
    : undefined;

  // Auto-dismiss the import toast after a few seconds.
  React.useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
    const requestId = importRequestRef.current + 1;
    importRequestRef.current = requestId;
    setImportDialog({
      open: true,
      fileName: file.name,
      loading: true,
      parsed: null,
    });
    try {
      if (file.size > MAX_ICS_FILE_BYTES) {
        setImportDialog({
          open: true,
          fileName: file.name,
          loading: false,
          parsed: null,
          readError: `This file is larger than ${Math.round(MAX_ICS_FILE_BYTES / 1024 / 1024)} MiB.`,
        });
        return;
      }
      const text = await file.text();
      const parsed = await parseICSImport(text, file.name);
      if (requestId !== importRequestRef.current) return;
      setImportDialog({
        open: true,
        fileName: file.name,
        loading: false,
        parsed,
      });
    } catch (error) {
      if (requestId !== importRequestRef.current) return;
      setImportDialog({
        open: true,
        fileName: file.name,
        loading: false,
        parsed: null,
        readError:
          error instanceof Error ? error.message : "Could not read that file.",
      });
    }
  };

  const closeImportDialog = () => {
    importRequestRef.current += 1;
    setImportDialog({
      open: false,
      fileName: "",
      loading: false,
      parsed: null,
    });
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
        "flex h-full w-full flex-col gap-1 overflow-y-auto p-3",
        className,
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="label-mono text-muted-foreground">
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

      {calendars.length === 0 && !creating && (
        <div className="flex flex-col items-start gap-1 rounded-md border border-dashed px-3 py-4">
          <span className="text-xs font-medium">No calendars yet</span>
          <p className="text-muted-foreground text-[11px]">
            Create a calendar to get started.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 text-xs"
            onClick={() => setCreating(true)}
          >
            <CalendarPlus className="size-3.5" />
            Create calendar
          </Button>
        </div>
      )}

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
              <div className="flex max-w-[180px] flex-wrap gap-1.5 p-1">
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
                onSelect={() => setPendingDeleteId(calendar.id)}
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

      {miniCalendar && (
        <div className="mt-3 flex justify-center border-t pt-3">
          {miniCalendar}
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1 border-t pt-2">
        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-xs"
          onClick={() => {
            if (calendars.length === 0) {
              setToast({
                title: "Nothing to import into",
                description: "Create a calendar before importing events.",
                variant: "error",
              });
              return;
            }
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
      </div>

      {/* Non-blocking import feedback toast (auto-dismisses). */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "bg-background fixed right-4 bottom-4 z-50 w-64 rounded-md border p-3 shadow-lg",
            toast.variant === "error" && "border-destructive/50",
          )}
        >
          <p
            className={cn(
              "text-xs font-medium",
              toast.variant === "error" && "text-destructive",
            )}
          >
            {toast.title}
          </p>
          {toast.description && (
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {toast.description}
            </p>
          )}
        </div>
      )}

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

      <ICSImportDialog
        open={importDialog.open}
        fileName={importDialog.fileName}
        loading={importDialog.loading}
        parsed={importDialog.parsed}
        readError={importDialog.readError}
        calendars={calendars}
        existingEvents={events}
        initialCalendarId={importTargetId ?? undefined}
        onClose={closeImportDialog}
        onImport={importEvents}
        onImported={(count, calendarName) => {
          closeImportDialog();
          setToast({
            title: `Imported ${count} event${count === 1 ? "" : "s"}`,
            description: `Added to ${calendarName}`,
            variant: "default",
          });
        }}
      />

      {/* Delete calendar confirmation. */}
      <TempoDialog
        open={pendingDeleteCalendar !== undefined}
        onClose={() => setPendingDeleteId(null)}
        title={`Delete "${pendingDeleteCalendar?.name ?? ""}"?`}
        description={(() => {
          const count = pendingDeleteCalendar
            ? (eventCountByCalendar.get(pendingDeleteCalendar.id) ?? 0)
            : 0;
          return count > 0
            ? `This will permanently delete the calendar and its ${count} event${count === 1 ? "" : "s"}.`
            : "This will permanently delete the calendar.";
        })()}
      >
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPendingDeleteId(null)}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (pendingDeleteCalendar) {
                deleteCalendar(pendingDeleteCalendar.id);
              }
              setPendingDeleteId(null);
            }}
          >
            Delete
          </Button>
        </div>
      </TempoDialog>
    </aside>
  );
}

// Re-export for convenience so callers don't need two imports.
export { createCalendarId };
