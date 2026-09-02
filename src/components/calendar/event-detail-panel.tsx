"use client";

import * as React from "react";
import * as ReactDOM from "react-dom";
import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  format,
} from "date-fns";
import {
  Check,
  ChevronDown,
  CircleHelp,
  Clock,
  Copy,
  MapPin,
  MoreHorizontal,
  RefreshCcw,
  SquareDashed,
  TabletSmartphone,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useCalendarData } from "@/features/calendar/calendar-data-context";
import {
  describeRecurrence,
  isWeekdayRule,
  toISODate,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { MiniCalendar } from "@/components/calendar/mini-calendar";
import { createEventHistoryLocationProvider } from "@/lib/location-suggestions";
import type { CalendarEvent, EventColor } from "./week-view-types";

interface EventDetailPanelProps {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
  onEventDelete?: (event: CalendarEvent) => void;
  onClose?: () => void;
  onPrevWeek?: () => void;
  onNextWeek?: () => void;
  /** Extra action buttons rendered in the header row (after the "..." menu). */
  headerActions?: React.ReactNode;
}

const colorDotClass: Record<EventColor, string> = {
  red: "bg-event-red-border",
  orange: "bg-event-orange-border",
  yellow: "bg-event-yellow-border",
  green: "bg-event-green-border",
  blue: "bg-event-blue-border",
  purple: "bg-event-purple-border",
  gray: "bg-event-gray-border",
};

function formatDuration(start: Date, end: Date): string {
  const totalMinutes = differenceInMinutes(end, start);

  if (totalMinutes < 60) {
    return `${totalMinutes}min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (minutes === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${minutes}min`;
}

function formatTimeDisplay(date: Date): string {
  const minutes = date.getMinutes();
  if (minutes === 0) {
    return format(date, "h a");
  }
  return format(date, "h:mm a");
}

interface ParsedTime {
  hours: number;
  minutes: number;
}

/**
 * Parses a user-typed time string into hours and minutes.
 * Accepts formats: "3 PM", "3:30 PM", "15:00", "3pm", "330pm", "3:30pm".
 * Returns null if the input cannot be parsed.
 */
function parseTimeInput(input: string): ParsedTime | null {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return null;
  }

  const isPM = /pm$/.test(trimmed);
  const isAM = /am$/.test(trimmed);
  const stripped = trimmed.replace(/\s*(am|pm)\s*$/, "").trim();

  if (stripped.length === 0) {
    return null;
  }

  let hours: number;
  let minutes: number;

  if (stripped.includes(":")) {
    const parts = stripped.split(":");
    if (parts.length !== 2) {
      return null;
    }
    hours = Number.parseInt(parts[0], 10);
    minutes = Number.parseInt(parts[1], 10);
  } else {
    const num = Number.parseInt(stripped, 10);
    if (Number.isNaN(num)) {
      return null;
    }
    if (stripped.length > 2 && num > 99) {
      // e.g., "330" → 3:30, "1230" → 12:30
      minutes = num % 100;
      hours = Math.floor(num / 100);
    } else {
      hours = num;
      minutes = 0;
    }
  }

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  // Apply AM/PM conversion
  if (isPM && hours < 12) {
    hours += 12;
  }
  if (isAM && hours === 12) {
    hours = 0;
  }

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return { hours, minutes };
}

/**
 * Returns a new Date with the same year/month/day as `base`
 * but with hours and minutes replaced.
 */
function applyTimeToDate(base: Date, hours: number, minutes: number): Date {
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function formatDateDisplay(date: Date): string {
  return format(date, "EEE MMM d");
}

type RecurrencePreset = "none" | "daily" | "weekly" | "weekdays" | "monthly" | "custom";

/**
 * Applying a recurrence rule to a previously non-recurring event turns it
 * into a series: the grid replaces the base event with expanded occurrences
 * (`baseId@@date` ids), which remounts this editor popover and drops its
 * local state. These one-shot sets carry the "keep the recurrence section
 * expanded / open the custom editor" intent across that remount.
 */
const pendingExpandedSeries = new Set<string>();
const pendingCustomSeries = new Set<string>();

function presetForRule(rule: RecurrenceRule | undefined, start: Date): RecurrencePreset {
  if (!rule) return "none";
  if (isWeekdayRule(rule)) return "weekdays";
  if (rule.freq === "daily" && (rule.interval ?? 1) === 1) return "daily";
  if (
    rule.freq === "weekly" &&
    (rule.interval ?? 1) === 1 &&
    (!rule.byWeekDays ||
      (rule.byWeekDays.length === 1 && rule.byWeekDays[0] === start.getDay()))
  )
    return "weekly";
  if (rule.freq === "monthly" && (rule.interval ?? 1) === 1) return "monthly";
  return "custom";
}

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Compact recurrence editor: preset dropdown plus (for custom weekly rules)
 * weekday toggles, and an end condition (never / on date / after N times).
 */
function RecurrenceEditor({
  event,
  onEventChange,
}: {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const rule = event.rrule;
  const preset = presetForRule(rule, event.start);
  const seriesId = event.baseId ?? event.id;
  const [customOpen, setCustomOpen] = React.useState(
    () => pendingCustomSeries.has(seriesId) || preset === "custom",
  );
  // Consume the pending intent once mounted (peeked above so StrictMode's
  // double-invoked initializer doesn't swallow it).
  React.useEffect(() => {
    pendingCustomSeries.delete(seriesId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyRule = (next: RecurrenceRule | undefined) => {
    onEventChange?.({
      ...event,
      rrule: next,
      recurrence: next ? describeRecurrence(next, event.start) : undefined,
    });
  };

  const selectPreset = (value: RecurrencePreset) => {
    if (value === "none") {
      applyRule(undefined);
      setCustomOpen(false);
      return;
    }
    // First rule on this series remounts the popover — carry intent across.
    if (!rule) {
      pendingExpandedSeries.add(seriesId);
    }
    if (value === "custom") {
      // Open the custom editor immediately; keep an existing custom rule
      // untouched and only seed a weekly rule when starting from none.
      setCustomOpen(true);
      if (!rule) {
        pendingCustomSeries.add(seriesId);
        applyRule({ freq: "weekly", byWeekDays: [event.start.getDay()] });
      }
      return;
    }
    const base: RecurrenceRule =
      value === "daily"
        ? { freq: "daily" }
        : value === "weekdays"
          ? { freq: "weekly", byWeekDays: [1, 2, 3, 4, 5] }
          : value === "weekly"
            ? { freq: "weekly", byWeekDays: [event.start.getDay()] }
            : { freq: "monthly" };
    applyRule(base);
  };

  const weekDays = rule?.byWeekDays ?? [event.start.getDay()];

  const toggleWeekDay = (day: number) => {
    if (!rule) return;
    const has = weekDays.includes(day);
    const next = has ? weekDays.filter((d) => d !== day) : [...weekDays, day];
    if (next.length === 0) return; // keep at least one day
    applyRule({ ...rule, freq: "weekly", byWeekDays: next.sort((a, b) => a - b) });
  };

  const endMode: "never" | "until" | "count" = rule?.until
    ? "until"
    : rule?.count
      ? "count"
      : "never";

  const presetLabel =
    preset === "none"
      ? "Does not repeat"
      : rule
        ? describeRecurrence(rule, event.start)
        : "Repeat";

  return (
    <div className="flex flex-col gap-2 px-4">
      <div className="flex items-center gap-3">
        <RefreshCcw className="size-4 shrink-0 text-[#C7C5C1] dark:text-[#595959]" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1 rounded-sm border border-transparent px-2 py-1 text-left text-xs hover:border-input dark:hover:border-[#373737]",
                rule ? "text-foreground" : "text-[#C7C5C1] dark:text-[#595959]",
              )}
            >
              <span className="truncate">{presetLabel}</span>
              <ChevronDown className="ml-auto size-3.5 shrink-0" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px]">
            {(
              [
                ["none", "Does not repeat"],
                ["daily", "Daily"],
                ["weekly", `Weekly on ${format(event.start, "EEEE")}`],
                ["weekdays", "Every weekday (Mon–Fri)"],
                ["monthly", `Monthly on day ${event.start.getDate()}`],
                ["custom", "Custom…"],
              ] as [RecurrencePreset, string][]
            ).map(([value, label]) => (
              <DropdownMenuItem
                key={value}
                className="text-xs"
                onSelect={() => selectPreset(value)}
              >
                {preset === value && <Check className="size-3.5" />}
                <span className={cn(preset !== value && "pl-5")}>{label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rule && (customOpen || preset === "custom") && (
        <div className="ml-7 flex items-center gap-1">
          {WEEKDAY_LABELS.map((label, day) => (
            <button
              key={day}
              type="button"
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-[10px]",
                weekDays.includes(day)
                  ? "bg-[#3A85D3] text-white"
                  : "text-[#C7C5C1] hover:bg-accent dark:hover:bg-[#242424] dark:text-[#595959]",
              )}
              onClick={() => toggleWeekDay(day)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {rule && (
        <div className="ml-7 flex items-center gap-2 text-xs">
          <span className="text-[#C7C5C1] dark:text-[#595959]">Ends</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="text-foreground flex items-center gap-1 rounded-sm border border-transparent px-1.5 py-0.5 hover:border-input dark:hover:border-[#373737]"
              >
                {endMode === "never"
                  ? "Never"
                  : endMode === "until"
                    ? "On date"
                    : "After N times"}
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => {
                  const { until: _u, count: _c, ...rest } = rule;
                  applyRule(rest);
                }}
              >
                Never
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() =>
                  applyRule({
                    ...rule,
                    count: undefined,
                    until: toISODate(addDays(event.start, 90)),
                  })
                }
              >
                On date
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() =>
                  applyRule({ ...rule, until: undefined, count: rule.count ?? 10 })
                }
              >
                After N times
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {endMode === "until" && (
            <UntilDatePicker
              until={rule.until!}
              onChange={(iso) => applyRule({ ...rule, until: iso })}
            />
          )}
          {endMode === "count" && (
            <input
              type="number"
              min={1}
              max={999}
              className="text-foreground w-16 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-input focus:border-ring focus:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:focus:border-[#242424] dark:focus:bg-[#242424] outline-none"
              value={rule.count ?? 10}
              onChange={(e) => {
                const n = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(n) && n > 0) applyRule({ ...rule, count: n });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * "Ends on" date picker for recurrence rules — same MiniCalendar + Popover
 * pattern as the event start/end date pickers.
 */
function UntilDatePicker({
  until,
  onChange,
}: {
  until: string;
  onChange: (iso: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const date = React.useMemo(() => new Date(`${until}T00:00:00`), [until]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Recurrence end date"
          className="text-foreground flex cursor-pointer items-center rounded-sm border border-transparent px-1.5 py-0.5 text-xs outline-none hover:border-input data-[state=open]:border-ring data-[state=open]:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:data-[state=open]:border-[#242424] dark:data-[state=open]:bg-[#242424]"
        >
          {formatDateDisplay(date)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <MiniCalendar
          currentDate={date}
          selectedDate={date}
          onSelect={(d) => {
            onChange(toISODate(d));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

const EVENT_TYPES = [
  "Event",
  "Focus time",
  "Out of office",
  "Birthday",
] as const;
type EventType = (typeof EVENT_TYPES)[number];

const EVENT_TYPE_TOOLTIPS: Partial<Record<EventType, string>> = {
  "Focus time":
    "Create a focus time event with the option to automatically decline meetings during this time. Available for work and school accounts.",
  "Out of office":
    "Create an out of office (OOO) event with the option to automatically decline meetings during this time. Available for work and school accounts.",
  Birthday:
    "Create a birthday event to keep track of a person's upcoming birthdays. Birthdays from your Google Contacts may appear on a separate Birthday calendar.",
};

function EventTypeHelpIcon({ tooltip }: { tooltip?: string }) {
  const [tooltipPos, setTooltipPos] = React.useState<{
    top: number;
    left: number;
  } | null>(null);

  if (!tooltip) {
    return null;
  }

  function handleMouseEnter(e: React.MouseEvent<HTMLSpanElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ top: rect.top + rect.height / 2, left: rect.left });
  }

  function handleMouseLeave() {
    setTooltipPos(null);
  }

  return (
    <span
      className="ml-auto shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <CircleHelp className="size-3.5 text-muted-foreground" />
      {tooltipPos &&
        ReactDOM.createPortal(
          <div
            className="pointer-events-none fixed z-[100] max-w-[240px] rounded-sm border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
            style={{
              top: tooltipPos.top,
              left: tooltipPos.left - 8,
              transform: "translate(-100%, -50%)",
            }}
          >
            {tooltip}
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * Editable Location field with client-side autocomplete. Suggestions come
 * from a pluggable LocationProvider (currently locations already used on the
 * user's events); typing always accepts free-form text.
 */
function LocationField({
  event,
  onEventChange,
}: {
  event: CalendarEvent;
  onEventChange?: (event: CalendarEvent) => void;
}) {
  const { events } = useCalendarData();
  const provider = React.useMemo(
    () => createEventHistoryLocationProvider(events),
    [events],
  );

  const [value, setValue] = React.useState(event.location ?? "");
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);

  // Sync when switching to a different event or the location changes externally.
  React.useEffect(() => {
    setValue(event.location ?? "");
  }, [event.id, event.location]);

  const suggestions = React.useMemo(
    () => (open ? provider.getSuggestions(value) : []),
    [open, provider, value],
  );

  const commit = (next: string) => {
    setValue(next);
    onEventChange?.({ ...event, location: next });
  };

  const selectSuggestion = (suggestion: string) => {
    commit(suggestion);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted(
        (i) => (i - 1 + suggestions.length) % suggestions.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSuggestion(suggestions[highlighted]);
    }
  };

  return (
    <div className="relative flex items-center gap-3 py-1">
      <MapPin className="size-4 shrink-0 text-[#C7C5C1] dark:text-[#595959]" />
      <input
        type="text"
        value={value}
        onChange={(e) => {
          commit(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Location"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-autocomplete="list"
        className="text-foreground placeholder:text-[#C7C5C1] dark:placeholder:text-[#595959] min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-xs outline-none hover:border-input focus:border-ring focus:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:focus:border-[#242424] dark:focus:bg-[#242424]"
      />
      {suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute top-full left-0 right-0 z-50 mt-1 overflow-hidden rounded-sm border bg-popover text-popover-foreground shadow-md"
        >
          {suggestions.map((suggestion, i) => (
            <li
              key={suggestion}
              role="option"
              aria-selected={i === highlighted}
              // Prevent input blur so the click registers before the list closes.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setHighlighted(i)}
              className={cn(
                "cursor-pointer truncate px-2 py-1.5 text-xs",
                i === highlighted
                  ? "bg-accent text-accent-foreground"
                  : "text-foreground",
              )}
            >
              {suggestion}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EventDetailPanel({
  event,
  onEventChange,
  onEventDelete,
  onClose,
  headerActions,
}: EventDetailPanelProps) {
  const color = event.color ?? "blue";
  const { calendars, duplicateEvent, copyEvent } = useCalendarData();
  const [eventType, setEventType] = React.useState<EventType>("Event");
  const [eventDropdownOpen, setEventDropdownOpen] = React.useState(false);
  const [hoveredOther, setHoveredOther] = React.useState(false);
  /** Whether the compact "All-day / Repeat" row is expanded into individual rows. */
  const [optionsExpanded, setOptionsExpanded] = React.useState(() =>
    pendingExpandedSeries.has(event.baseId ?? event.id),
  );
  React.useEffect(() => {
    pendingExpandedSeries.delete(event.baseId ?? event.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [titleValue, setTitleValue] = React.useState(event.title);
  const titleRef = React.useRef<HTMLInputElement>(null);
  const escapePressedRef = React.useRef(false);
  /** Stores the title when the input gains focus, used to restore on Escape. */
  const titleOnFocusRef = React.useRef(event.title);

  React.useEffect(() => {
    setTitleValue(event.title);
  }, [event.title]);

  // Reset expanded options when switching to a different event (not on mount,
  // so the pending-expanded intent above survives). Keyed on the series
  // identity (baseId) so applying a recurrence rule — which renames the event
  // to an occurrence id — does not collapse the open editor.
  const seriesKey = event.baseId ?? event.id;
  const prevSeriesKeyRef = React.useRef(seriesKey);
  React.useEffect(() => {
    if (prevSeriesKeyRef.current !== seriesKey) {
      prevSeriesKeyRef.current = seriesKey;
      setOptionsExpanded(false);
    }
  }, [seriesKey]);

  const handleTitleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = e.target.value;
      setTitleValue(next);
      onEventChange?.({ ...event, title: next });
    },
    [event, onEventChange],
  );

  const handleTitleFocus = React.useCallback(() => {
    titleOnFocusRef.current = event.title;
  }, [event.title]);

  const commitTitle = React.useCallback(() => {
    if (escapePressedRef.current) {
      escapePressedRef.current = false;
      return;
    }
    const trimmed = titleValue.trim();
    if (trimmed === titleValue) {
      return;
    }
    onEventChange?.({ ...event, title: trimmed });
  }, [titleValue, event, onEventChange]);

  const handleTitleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        titleRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escapePressedRef.current = true;
        const original = titleOnFocusRef.current;
        setTitleValue(original);
        onEventChange?.({ ...event, title: original });
        titleRef.current?.blur();
      }
    },
    [event, onEventChange],
  );

  // --- Start time input state & handlers ---
  const [startTimeValue, setStartTimeValue] = React.useState(() =>
    formatTimeDisplay(event.start),
  );
  const startTimeRef = React.useRef<HTMLInputElement>(null);
  const startTimeEscapePressedRef = React.useRef(false);
  const startTimeOnFocusRef = React.useRef(formatTimeDisplay(event.start));

  React.useEffect(() => {
    setStartTimeValue(formatTimeDisplay(event.start));
  }, [event.start]);

  const handleStartTimeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setStartTimeValue(e.target.value);
    },
    [],
  );

  const handleStartTimeFocus = React.useCallback(() => {
    startTimeOnFocusRef.current = formatTimeDisplay(event.start);
    requestAnimationFrame(() => {
      startTimeRef.current?.select();
    });
  }, [event.start]);

  const commitStartTime = React.useCallback(() => {
    if (startTimeEscapePressedRef.current) {
      startTimeEscapePressedRef.current = false;
      return;
    }
    const parsed = parseTimeInput(startTimeValue);
    if (!parsed) {
      setStartTimeValue(startTimeOnFocusRef.current);
      return;
    }
    const newStart = applyTimeToDate(event.start, parsed.hours, parsed.minutes);
    if (newStart.getTime() >= event.end.getTime()) {
      setStartTimeValue(startTimeOnFocusRef.current);
      return;
    }
    setStartTimeValue(formatTimeDisplay(newStart));
    onEventChange?.({ ...event, start: newStart });
  }, [startTimeValue, event, onEventChange]);

  const handleStartTimeKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        startTimeRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        startTimeEscapePressedRef.current = true;
        setStartTimeValue(startTimeOnFocusRef.current);
        startTimeRef.current?.blur();
      }
    },
    [],
  );

  // --- End time input state & handlers ---
  const [endTimeValue, setEndTimeValue] = React.useState(() =>
    formatTimeDisplay(event.end),
  );
  const endTimeRef = React.useRef<HTMLInputElement>(null);
  const endTimeEscapePressedRef = React.useRef(false);
  const endTimeOnFocusRef = React.useRef(formatTimeDisplay(event.end));

  React.useEffect(() => {
    setEndTimeValue(formatTimeDisplay(event.end));
  }, [event.end]);

  const handleEndTimeChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEndTimeValue(e.target.value);
    },
    [],
  );

  const handleEndTimeFocus = React.useCallback(() => {
    endTimeOnFocusRef.current = formatTimeDisplay(event.end);
    requestAnimationFrame(() => {
      endTimeRef.current?.select();
    });
  }, [event.end]);

  const commitEndTime = React.useCallback(() => {
    if (endTimeEscapePressedRef.current) {
      endTimeEscapePressedRef.current = false;
      return;
    }
    const parsed = parseTimeInput(endTimeValue);
    if (!parsed) {
      setEndTimeValue(endTimeOnFocusRef.current);
      return;
    }
    const newEnd = applyTimeToDate(event.end, parsed.hours, parsed.minutes);
    if (newEnd.getTime() <= event.start.getTime()) {
      setEndTimeValue(endTimeOnFocusRef.current);
      return;
    }
    setEndTimeValue(formatTimeDisplay(newEnd));
    onEventChange?.({ ...event, end: newEnd });
  }, [endTimeValue, event, onEventChange]);

  const handleEndTimeKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        endTimeRef.current?.blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        endTimeEscapePressedRef.current = true;
        setEndTimeValue(endTimeOnFocusRef.current);
        endTimeRef.current?.blur();
      }
    },
    [],
  );

  // --- Date picker popovers (start date, and end date for all-day events) ---
  const [startDateOpen, setStartDateOpen] = React.useState(false);
  const [endDateOpen, setEndDateOpen] = React.useState(false);

  const handleStartDateSelect = React.useCallback(
    (day: Date) => {
      setStartDateOpen(false);
      const dayDiff = differenceInCalendarDays(day, event.start);
      if (dayDiff === 0) {
        return;
      }
      // Shift both start and end by the same number of days, preserving time.
      onEventChange?.({
        ...event,
        start: addDays(event.start, dayDiff),
        end: addDays(event.end, dayDiff),
      });
    },
    [event, onEventChange],
  );

  const handleEndDateSelect = React.useCallback(
    (day: Date) => {
      setEndDateOpen(false);
      const dayDiff = differenceInCalendarDays(day, event.end);
      if (dayDiff === 0) {
        return;
      }
      const newEnd = addDays(event.end, dayDiff);
      if (newEnd.getTime() < event.start.getTime()) {
        return;
      }
      onEventChange?.({ ...event, end: newEnd });
    },
    [event, onEventChange],
  );

  // --- All-day toggle handler ---
  /**
   * Stores the original hours/minutes before toggling to all-day.
   * When toggling off, these are applied to the current (possibly resized) dates.
   */
  const savedTimeOfDayRef = React.useRef<{
    startHours: number;
    startMinutes: number;
    endHours: number;
    endMinutes: number;
  } | null>(null);

  const handleAllDayToggle = React.useCallback(
    (checked: boolean) => {
      if (checked) {
        savedTimeOfDayRef.current = {
          startHours: event.start.getHours(),
          startMinutes: event.start.getMinutes(),
          endHours: event.end.getHours(),
          endMinutes: event.end.getMinutes(),
        };
        onEventChange?.({ ...event, isAllDay: true });
        return;
      }

      if (savedTimeOfDayRef.current) {
        const { startHours, startMinutes, endHours, endMinutes } =
          savedTimeOfDayRef.current;
        onEventChange?.({
          ...event,
          isAllDay: false,
          start: applyTimeToDate(event.start, startHours, startMinutes),
          end: applyTimeToDate(event.end, endHours, endMinutes),
        });
        savedTimeOfDayRef.current = null;
        return;
      }

      /** Default 9 AM – 10 AM when no saved times (e.g., existing all-day event). */
      const DEFAULT_START_HOUR = 9;
      const DEFAULT_END_HOUR = 10;
      onEventChange?.({
        ...event,
        isAllDay: false,
        start: applyTimeToDate(event.start, DEFAULT_START_HOUR, 0),
        end: applyTimeToDate(event.end, DEFAULT_END_HOUR, 0),
      });
    },
    [event, onEventChange],
  );

  const otherTypes = EVENT_TYPES.filter((t) => t !== eventType);

  return (
    <div className="flex flex-col gap-3 py-3">
      {/* Header */}
      <div className="flex items-center justify-between px-4">
        <DropdownMenu
          open={eventDropdownOpen}
          onOpenChange={(open) => {
            setEventDropdownOpen(open);
            if (open) setHoveredOther(false);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-0.5 text-xs font-medium rounded-sm border border-transparent px-2.5 py-1.5 -ml-2.5 gap-1.5 hover:border-input dark:hover:border-[#373737]",
                eventDropdownOpen
                  ? "bg-accent text-foreground dark:bg-[#242424]"
                  : "text-foreground",
              )}
            >
              {eventType}
              <ChevronDown
                className={cn(
                  "size-3.5",
                  eventDropdownOpen
                    ? "text-[#595959]"
                    : "text-[#C7C5C1] dark:text-[#595959]",
                )}
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="left"
            sideOffset={12}
            alignOffset={-4}
            className="min-w-[180px]"
            onMouseLeave={() => setHoveredOther(false)}
          >
            <DropdownMenuItem
              className={cn(
                "group/item text-xs",
                !hoveredOther && "bg-accent",
              )}
              onSelect={() => setEventType(eventType)}
              onMouseEnter={() => setHoveredOther(false)}
            >
              <Check className="size-3.5" />
              <span className="flex-1">{eventType}</span>
              <EventTypeHelpIcon tooltip={EVENT_TYPE_TOOLTIPS[eventType]} />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {otherTypes.map((type) => (
              <DropdownMenuItem
                key={type}
                className="group/item text-xs pl-8"
                onSelect={() => setEventType(type)}
                onMouseEnter={() => setHoveredOther(true)}
              >
                <span className="flex-1">{type}</span>
                <EventTypeHelpIcon tooltip={EVENT_TYPE_TOOLTIPS[type]} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 border border-transparent hover:border-ring hover:bg-accent dark:hover:border-[#242424] dark:hover:bg-[#242424] text-[#C7C5C1] dark:text-[#595959]"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="left"
              className="min-w-[180px]"
            >
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => {
                  copyEvent(event);
                  onEventDelete?.(event);
                  onClose?.();
                }}
              >
                <SquareDashed className="size-3.5" />
                Cut
                <DropdownMenuShortcut className="text-muted-foreground">
                  ⌘X
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => copyEvent(event)}
              >
                <TabletSmartphone className="size-3.5" />
                Copy
                <DropdownMenuShortcut className="text-muted-foreground">
                  ⌘C
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => {
                  duplicateEvent(event);
                  onClose?.();
                }}
              >
                <Copy className="size-3.5" />
                Duplicate
                <DropdownMenuShortcut className="text-muted-foreground">
                  ⌘D
                </DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-xs text-[#E56458] focus:!bg-[#DE5551] focus:!text-white focus:[&>svg]:!text-white focus:[&>[data-slot=dropdown-menu-shortcut]]:!text-white"
                onSelect={() => {
                  onEventDelete?.(event);
                  onClose?.();
                }}
              >
                <Trash2 className="size-3.5 text-[#E56458]" />
                Delete
                <DropdownMenuShortcut className="text-muted-foreground tracking-normal">
                  delete
                </DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {headerActions}
        </div>
      </div>

      {/* Title */}
      <input
        ref={titleRef}
        type="text"
        value={titleValue}
        onChange={handleTitleChange}
        onFocus={handleTitleFocus}
        onBlur={commitTitle}
        onKeyDown={handleTitleKeyDown}
        placeholder="Title"
        className="text-foreground placeholder:text-[#C7C5C1] dark:placeholder:text-[#595959] mx-2 rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-xs outline-none hover:border-input focus:border-ring focus:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:focus:border-[#242424] dark:focus:bg-[#242424]"
      />

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Time — muted and non-interactive for all-day events */}
      {(event.start.getHours() !== 0 ||
        event.start.getMinutes() !== 0 ||
        event.end.getHours() !== 0 ||
        event.end.getMinutes() !== 0) && (
        <div className="flex min-w-0 items-center gap-1 px-2 text-xs">
          {/* Start time group — Clock icon + input in one bordered container */}
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-sm border border-transparent px-2 py-1.5",
              event.isAllDay
                ? "cursor-default"
                : "cursor-text hover:border-input dark:hover:border-[#373737] has-[:focus]:border-ring has-[:focus]:bg-accent dark:has-[:focus]:border-[#242424] dark:has-[:focus]:bg-[#242424]",
            )}
            onClick={
              event.isAllDay ? undefined : () => startTimeRef.current?.focus()
            }
          >
            <Clock className="size-4 shrink-0 text-[#C7C5C1] dark:text-[#595959]" />
            <input
              ref={startTimeRef}
              type="text"
              value={startTimeValue}
              onChange={handleStartTimeChange}
              onFocus={handleStartTimeFocus}
              onBlur={commitStartTime}
              onKeyDown={handleStartTimeKeyDown}
              readOnly={event.isAllDay}
              tabIndex={event.isAllDay ? -1 : undefined}
              className={cn(
                "w-[8ch] font-medium text-xs bg-transparent outline-none border-none p-0",
                event.isAllDay
                  ? "text-[#C7C5C1] dark:text-[#595959] pointer-events-none"
                  : "text-foreground",
              )}
            />
          </div>
          {/* End time group — arrow + input + duration in one bordered container */}
          <div
            className={cn(
              "flex min-w-0 flex-1 items-center rounded-sm border border-transparent px-2 py-1.5",
              event.isAllDay
                ? "cursor-default"
                : "cursor-text hover:border-input dark:hover:border-[#373737] has-[:focus]:border-ring has-[:focus]:bg-accent dark:has-[:focus]:border-[#242424] dark:has-[:focus]:bg-[#242424]",
            )}
            onClick={
              event.isAllDay ? undefined : () => endTimeRef.current?.focus()
            }
          >
            <span className="mr-2 shrink-0 text-base leading-4 text-[#C7C5C1] dark:text-[#595959]">
              →
            </span>
            <input
              ref={endTimeRef}
              type="text"
              value={endTimeValue}
              onChange={handleEndTimeChange}
              onFocus={handleEndTimeFocus}
              onBlur={commitEndTime}
              onKeyDown={handleEndTimeKeyDown}
              readOnly={event.isAllDay}
              tabIndex={event.isAllDay ? -1 : undefined}
              className={cn(
                "min-w-0 font-medium text-xs bg-transparent outline-none border-none p-0",
                event.isAllDay
                  ? "text-[#C7C5C1] dark:text-[#595959] pointer-events-none"
                  : "text-foreground",
              )}
              size={endTimeValue.length}
            />
            <span className="shrink-0 text-[#C7C5C1] dark:text-[#595959]">
              {formatDuration(event.start, event.end)}
            </span>
          </div>
        </div>
      )}

      {/* Date — date-picker popover(s), indented to align with time text */}
      <div
        className={cn(
          "flex items-center gap-2 -mt-2",
          event.start.getHours() !== 0 ||
            event.start.getMinutes() !== 0 ||
            event.end.getHours() !== 0 ||
            event.end.getMinutes() !== 0
            ? "ml-8"
            : "ml-4",
        )}
      >
        {/* Start date */}
        <Popover open={startDateOpen} onOpenChange={setStartDateOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Start date"
              className="text-foreground mr-0 flex min-w-[6.5rem] cursor-pointer items-center self-start rounded-sm border border-transparent px-2 py-1.5 text-xs outline-none hover:border-input data-[state=open]:border-ring data-[state=open]:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:data-[state=open]:border-[#242424] dark:data-[state=open]:bg-[#242424]"
            >
              {formatDateDisplay(event.start)}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <MiniCalendar
              currentDate={event.start}
              selectedDate={event.start}
              onSelect={handleStartDateSelect}
            />
          </PopoverContent>
        </Popover>
        {/* End date — only visible for all-day events */}
        {event.isAllDay && (
          <Popover open={endDateOpen} onOpenChange={setEndDateOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="End date"
                className="text-foreground flex min-w-[6.5rem] cursor-pointer items-center self-start rounded-sm border border-transparent px-2 py-1.5 text-xs outline-none hover:border-input data-[state=open]:border-ring data-[state=open]:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:data-[state=open]:border-[#242424] dark:data-[state=open]:bg-[#242424]"
              >
                {formatDateDisplay(event.end)}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <MiniCalendar
                currentDate={event.end}
                selectedDate={event.end}
                onSelect={handleEndDateSelect}
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {optionsExpanded || event.isAllDay ? (
        <>
          {/* All-day toggle row — clicking label or row triggers toggle */}
          <div
            className="flex cursor-default items-center gap-3 px-4"
            onClick={() => handleAllDayToggle(!(event.isAllDay ?? false))}
          >
            <Switch
              size="xs"
              checked={event.isAllDay ?? false}
              onCheckedChange={handleAllDayToggle}
              onClick={(e) => e.stopPropagation()}
              className="data-[state=unchecked]:!bg-[#C7C5C1] dark:data-[state=unchecked]:!bg-[#595959] data-[state=checked]:!bg-[#3A85D3]"
            />
            <span className="text-foreground text-xs">All-day</span>
          </div>

          {/* Recurrence editor */}
          <RecurrenceEditor event={event} onEventChange={onEventChange} />
        </>
      ) : (
        <div className="-mt-2 flex items-center pl-8">
          <div
            className="group/options flex cursor-default items-center gap-4 rounded-sm px-2 py-1.5 hover:bg-[#E8E8E4] dark:hover:bg-[#242424]"
            onClick={() => setOptionsExpanded(true)}
          >
            <span className="text-xs text-[#C7C5C1] dark:text-[#595959] dark:group-hover/options:text-[#636363]">
              All-day
            </span>
            <span className="text-xs text-[#C7C5C1] dark:text-[#595959] dark:group-hover/options:text-[#636363]">
              Repeat
            </span>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Location */}
      <div className="flex flex-col px-4">
        <LocationField event={event} onEventChange={onEventChange} />
      </div>

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Description */}
      <div className="flex flex-col gap-1 px-4">
        <textarea
          value={event.description ?? ""}
          onChange={(e) =>
            onEventChange?.({ ...event, description: e.target.value })
          }
          placeholder="Description"
          rows={2}
          className="text-foreground placeholder:text-[#C7C5C1] dark:placeholder:text-[#595959] -mx-2 resize-none rounded-sm border border-transparent bg-transparent px-2 py-1.5 text-xs outline-none hover:border-input focus:border-ring focus:bg-accent focus-visible:ring-ring focus-visible:ring-1 dark:hover:border-[#373737] dark:focus:border-[#242424] dark:focus:bg-[#242424]"
        />
      </div>

      {/* Divider */}
      <div className="border-border border-t" />

      {/* Calendar — dropdown to move the event between calendars */}
      <div className="flex items-center gap-2 px-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-sm border border-transparent px-2 py-1 -ml-2 hover:border-input dark:hover:border-[#373737]"
            >
              <div
                className={cn(
                  "size-3 rounded-xs",
                  colorDotClass[
                    calendars.find((c) => c.id === event.calendarId)?.color ??
                      color
                  ],
                )}
              />
              <span className="text-foreground text-xs">
                {calendars.find((c) => c.id === event.calendarId)?.name ??
                  "No calendar"}
              </span>
              <ChevronDown className="size-3 text-[#C7C5C1] dark:text-[#595959]" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[160px]">
            {calendars.map((cal) => (
              <DropdownMenuItem
                key={cal.id}
                className="text-xs"
                onSelect={() => onEventChange?.({ ...event, calendarId: cal.id })}
              >
                <div className={cn("size-3 rounded-xs", colorDotClass[cal.color])} />
                <span className="flex-1">{cal.name}</span>
                {event.calendarId === cal.id && <Check className="size-3.5" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

    </div>
  );
}
