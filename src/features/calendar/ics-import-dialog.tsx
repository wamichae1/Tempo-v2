import * as React from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CalendarArrowDown,
  CheckCircle2,
  Clock3,
  Copy,
  LoaderCircle,
  XCircle,
} from "lucide-react";

import type { CalendarEvent } from "@/components/calendar";
import { Button } from "@/components/ui/button";
import { TempoDialog } from "@/components/ui/tempo-dialog";
import type { Calendar } from "@/features/calendar/types";
import type {
  CalendarEventImport,
  ImportEventsResult,
} from "@/features/calendar/use-calendar-events";
import { EVENT_COLOR_DOT_CLASS } from "@/features/calendar/types";
import {
  analyzeICSImport,
  type ICSImportParseResult,
  type ICSImportPreviewItem,
} from "@/lib/ics-import";
import { cn } from "@/lib/utils";

export interface ICSImportDialogProps {
  open: boolean;
  fileName: string;
  loading: boolean;
  parsed: ICSImportParseResult | null;
  readError?: string;
  calendars: Calendar[];
  existingEvents: CalendarEvent[];
  initialCalendarId?: string;
  onClose: () => void;
  onImport: (
    events: CalendarEventImport[],
    calendarId: string,
  ) => ImportEventsResult;
  onImported: (count: number, calendarName: string) => void;
}

function eventTimeLabel(item: ICSImportPreviewItem): string {
  const event = item.event;
  if (!event) return "Unavailable";
  if (event.isAllDay) {
    const sameDay =
      event.start.getFullYear() === event.end.getFullYear() &&
      event.start.getMonth() === event.end.getMonth() &&
      event.start.getDate() === event.end.getDate();
    return sameDay
      ? `${format(event.start, "MMM d, yyyy")} · All day`
      : `${format(event.start, "MMM d")} – ${format(event.end, "MMM d, yyyy")} · All day`;
  }
  const sameDay =
    event.start.getFullYear() === event.end.getFullYear() &&
    event.start.getMonth() === event.end.getMonth() &&
    event.start.getDate() === event.end.getDate();
  return sameDay
    ? `${format(event.start, "MMM d, yyyy")} · ${format(event.start, "h:mm a")} – ${format(event.end, "h:mm a")}`
    : `${format(event.start, "MMM d, h:mm a")} – ${format(event.end, "MMM d, h:mm a")}`;
}

function timezoneLabel(item: ICSImportPreviewItem): string | undefined {
  const source = item.event?.source;
  if (!source || source.kind !== "ics") return undefined;
  const mode = source.time.startMode;
  if (mode === "floating") return "Floating time";
  if (mode === "utc") return "UTC";
  if (mode === "zoned") return source.time.startTzid;
  return undefined;
}

function issueIcon(item: ICSImportPreviewItem) {
  if (!item.event) return <XCircle className="text-destructive size-3.5" />;
  if (item.duplicate) return <Copy className="size-3.5 text-amber-600" />;
  if (item.conflicts.length > 0) {
    return <AlertTriangle className="size-3.5 text-amber-600" />;
  }
  if (item.issues.length > 0) {
    return <AlertTriangle className="text-muted-foreground size-3.5" />;
  }
  return <CheckCircle2 className="size-3.5 text-emerald-600" />;
}

function ReadyPreview({
  parsed,
  calendars,
  existingEvents,
  initialCalendarId,
  onClose,
  onImport,
  onImported,
}: Omit<
  ICSImportDialogProps,
  "open" | "fileName" | "loading" | "parsed" | "readError"
> & { parsed: ICSImportParseResult }) {
  const analysis = React.useMemo(
    () => analyzeICSImport(parsed, existingEvents),
    [parsed, existingEvents],
  );
  const defaultCalendar =
    calendars.find((calendar) => calendar.id === initialCalendarId) ??
    calendars.find((calendar) => calendar.visible) ??
    calendars[0];
  const [calendarId, setCalendarId] = React.useState(defaultCalendar?.id ?? "");
  const [selected, setSelected] = React.useState<Set<string>>(
    () =>
      new Set(
        analysis.items
          .filter((item) => item.event && !item.duplicate)
          .map((item) => item.key),
      ),
  );
  const [commitError, setCommitError] = React.useState<string>();

  const validCalendarId = calendars.some((calendar) => calendar.id === calendarId)
    ? calendarId
    : (calendars.find((calendar) => calendar.visible) ?? calendars[0])?.id ?? "";
  const selectedItems = analysis.items.filter(
    (item) => item.event && selected.has(item.key),
  );
  const selectableItems = analysis.items.filter((item) => item.event);
  const selectedConflicts = selectedItems.filter(
    (item) => item.conflicts.length > 0,
  ).length;
  const selectedDuplicates = selectedItems.filter((item) => item.duplicate).length;
  const unsupportedCount = analysis.items.filter((item) => !item.event).length;
  const allSelected =
    selectableItems.length > 0 &&
    selectableItems.every((item) => selected.has(item.key));

  const toggle = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setCommitError(undefined);
  };

  const submit = () => {
    if (!validCalendarId) {
      setCommitError("Create a calendar before importing events.");
      return;
    }
    const drafts = selectedItems
      .map((item) => item.event)
      .filter((event): event is CalendarEventImport => event !== undefined);
    const result = onImport(drafts, validCalendarId);
    if (!result.ok) {
      setCommitError(result.error);
      return;
    }
    const calendarName =
      calendars.find((calendar) => calendar.id === validCalendarId)?.name ??
      "calendar";
    onImported(result.events.length, calendarName);
  };

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <div>
          <p className="text-xs font-medium">
            {parsed.totalEvents} event{parsed.totalEvents === 1 ? "" : "s"} found
          </p>
          <p className="text-muted-foreground text-[11px]">
            {selectableItems.length} ready · {unsupportedCount} unsupported
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Destination</span>
          {validCalendarId && (
            <span
              className={cn(
                "size-2.5 rounded-xs",
                EVENT_COLOR_DOT_CLASS[
                  calendars.find((calendar) => calendar.id === validCalendarId)
                    ?.color ?? "blue"
                ],
              )}
            />
          )}
          <select
            aria-label="Destination calendar"
            className="rounded-md border bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1"
            value={validCalendarId}
            onChange={(event) => {
              setCalendarId(event.target.value);
              setCommitError(undefined);
            }}
          >
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between border-b pb-2">
        <label className="flex items-center gap-2 text-xs font-medium">
          <input
            type="checkbox"
            checked={allSelected}
            disabled={selectableItems.length === 0}
            onChange={(event) =>
              setSelected(
                event.target.checked
                  ? new Set(selectableItems.map((item) => item.key))
                  : new Set(),
              )
            }
          />
          Select all importable events
        </label>
        <span className="text-muted-foreground text-[11px]">
          {selectedItems.length} selected
        </span>
      </div>

      <div className="max-h-[52vh] overflow-y-auto py-1">
        {analysis.items.map((item) => {
          const tz = timezoneLabel(item);
          const unsupported = !item.event;
          return (
            <div
              key={item.key}
              className={cn(
                "flex gap-3 border-b px-1 py-3 last:border-b-0",
                unsupported && "opacity-70",
              )}
            >
              <input
                aria-label={`Select ${item.title}`}
                type="checkbox"
                className="mt-0.5 size-4"
                checked={selected.has(item.key)}
                disabled={unsupported}
                onChange={() => toggle(item.key)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 truncate text-xs font-medium">
                    {item.title}
                  </p>
                  {issueIcon(item)}
                </div>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  {eventTimeLabel(item)}
                </p>
                {(item.event?.recurrence || tz || item.event?.source?.calendarName) && (
                  <p className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                    {item.event?.recurrence && <span>{item.event.recurrence}</span>}
                    {tz && (
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="size-2.5" />
                        {tz}
                      </span>
                    )}
                    {item.event?.source?.calendarName && (
                      <span>From {item.event.source.calendarName}</span>
                    )}
                  </p>
                )}
                {item.duplicate && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                    <strong>
                      {item.duplicate.kind === "uid"
                        ? "Duplicate: "
                        : "Possible duplicate: "}
                    </strong>
                    {item.duplicate.message}
                  </p>
                )}
                {item.conflicts.slice(0, 2).map((conflict) => (
                  <p
                    key={conflict.eventId}
                    className="mt-1 text-[11px] text-amber-700 dark:text-amber-400"
                  >
                    <strong>Conflict: </strong>
                    overlaps with “{conflict.title}” ·{" "}
                    {format(conflict.start, "MMM d, h:mm a")}
                  </p>
                ))}
                {item.issues.map((issue, index) => (
                  <p
                    key={`${issue.message}-${index}`}
                    className={cn(
                      "mt-1 text-[11px]",
                      issue.severity === "unsupported"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {issue.message}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {analysis.boundedRecurrenceAnalysis && (
        <p className="text-muted-foreground mt-2 text-[10px]">
          Open-ended recurring conflicts were checked for the first 12 months or
          100 occurrences.
        </p>
      )}
      {commitError && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {commitError}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <p className="text-muted-foreground text-[11px]">
          {selectedItems.length} ready to import
          {selectedConflicts > 0 && ` · ${selectedConflicts} conflicts`}
          {selectedDuplicates > 0 && ` · ${selectedDuplicates} duplicates`}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={selectedItems.length === 0 || !validCalendarId}
            onClick={submit}
          >
            <CalendarArrowDown className="size-3.5" />
            Import {selectedItems.length} Event
            {selectedItems.length === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </>
  );
}

export function ICSImportDialog(props: ICSImportDialogProps) {
  const { open, fileName, loading, parsed, readError, onClose } = props;
  const fatalIssues = parsed?.issues.filter(
    (issue) => issue.severity === "unsupported",
  );

  return (
    <TempoDialog
      open={open}
      onClose={onClose}
      title="Import Calendar"
      description={fileName}
      role="dialog"
      widthClass="w-[min(680px,calc(100vw-24px))]"
      className="max-h-[90vh] overflow-hidden"
    >
      {loading ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-xs">
          <LoaderCircle className="size-4 animate-spin" />
          Reading and validating calendar…
        </div>
      ) : readError ? (
        <div className="py-8 text-center">
          <XCircle className="text-destructive mx-auto size-6" />
          <p role="alert" className="mt-2 text-sm font-medium">
            Import failed
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{readError}</p>
          <Button className="mt-4" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : parsed && fatalIssues && fatalIssues.length > 0 && parsed.candidates.length === 0 ? (
        <div className="py-8 text-center">
          <XCircle className="text-destructive mx-auto size-6" />
          <p role="alert" className="mt-2 text-sm font-medium">
            This calendar cannot be imported
          </p>
          {fatalIssues.map((issue) => (
            <p key={issue.message} className="text-muted-foreground mt-1 text-xs">
              {issue.message}
            </p>
          ))}
          <Button className="mt-4" variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : parsed ? (
        <ReadyPreview
          parsed={parsed}
          calendars={props.calendars}
          existingEvents={props.existingEvents}
          initialCalendarId={props.initialCalendarId}
          onClose={props.onClose}
          onImport={props.onImport}
          onImported={props.onImported}
        />
      ) : null}
    </TempoDialog>
  );
}

