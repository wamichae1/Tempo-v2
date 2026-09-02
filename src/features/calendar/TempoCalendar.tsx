import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  isWithinInterval,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";

import {
  WeekView,
  getCalendarHeaderInfo,
  getVisibleDays,
  type CalendarEvent,
  type ViewType,
} from "@/components/calendar";
import { MonthView } from "@/components/calendar/month-view";
import { MiniCalendar } from "@/components/calendar/mini-calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  createEventId,
  useCalendarEvents,
} from "@/features/calendar/use-calendar-events";
import { CalendarDataProvider } from "@/features/calendar/calendar-data-context";
import { CalendarSidebar } from "@/features/calendar/calendar-sidebar";
import { SearchPopover } from "@/features/calendar/search-popover";
import { useAgentTools } from "@/features/agent/use-agent-tools";
import { AgentPanel } from "@/features/agent/agent-panel";
import { AgentConfirmDialog } from "@/features/agent/agent-confirm-dialog";
import { expandEvents } from "@/lib/recurrence";
import { findConflictingEventIds } from "@/lib/conflicts";

const WEEK_STARTS_ON = 0;
const LS_VIEW = "tempo:view";

type MainView = Extract<ViewType, "week" | "month">;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}

export function TempoCalendar() {
  const [view, setView] = useState<MainView>(() => {
    const saved = localStorage.getItem(LS_VIEW);
    return saved === "month" ? "month" : "week";
  });
  const [currentDate, setCurrentDate] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
  );
  const store = useCalendarEvents();
  const agent = useAgentTools(store);
  const {
    events,
    calendars,
    addEvent,
    updateEvent,
    deleteEvent,
    duplicateEvent,
    copyEvent,
    pasteEvent,
    clipboard,
    undo,
    redo,
    canUndo,
    canRedo,
  } = store;
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [visibleDays, setVisibleDays] = useState<Date[]>(() =>
    getVisibleDays(currentDate, "week"),
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [highlightedDate, setHighlightedDate] = useState<Date | null>(null);

  useEffect(() => {
    localStorage.setItem(LS_VIEW, view);
  }, [view]);

  /**
   * Switch views, re-anchoring the date so the target view shows the bulk of
   * what was on screen (e.g. a week that straddles a month boundary maps to
   * the month containing most of its days).
   */
  const switchView = useCallback(
    (next: MainView) => {
      if (next === view) return;
      if (next === "month") {
        setCurrentDate((d) => startOfMonth(addDays(d, 3)));
      } else {
        setCurrentDate((d) => startOfWeek(d, { weekStartsOn: WEEK_STARTS_ON }));
      }
      setView(next);
    },
    [view],
  );

  // --- Derived display events ---------------------------------------------
  // Expand recurrence over the visible range (+1 week buffer), hide events on
  // hidden calendars, and resolve each event's color (event override →
  // calendar color).
  const displayEvents = useMemo(() => {
    const rangeStart =
      view === "month"
        ? startOfWeek(startOfMonth(currentDate), { weekStartsOn: WEEK_STARTS_ON })
        : addDays(currentDate, -7);
    const rangeEnd =
      view === "month"
        ? addDays(endOfWeek(endOfMonth(currentDate), { weekStartsOn: WEEK_STARTS_ON }), 1)
        : addDays(currentDate, 14);

    const colorByCalendar = new Map(calendars.map((c) => [c.id, c.color]));
    const hiddenCalendars = new Set(
      calendars.filter((c) => !c.visible).map((c) => c.id),
    );

    return expandEvents(events, rangeStart, rangeEnd)
      .filter((e) => !hiddenCalendars.has(e.calendarId ?? ""))
      .map((e) =>
        e.color
          ? e
          : { ...e, color: colorByCalendar.get(e.calendarId ?? "") ?? "blue" },
      );
  }, [events, calendars, currentDate, view]);

  const conflictIds = useMemo(
    () => findConflictingEventIds(displayEvents),
    [displayEvents],
  );

  const headerDate =
    view === "month" ? currentDate : (visibleDays[0] ?? currentDate);
  const { monthName, year, weekNumber } = getCalendarHeaderInfo(
    headerDate,
    WEEK_STARTS_ON,
  );

  const selectedEvent = useMemo(
    () =>
      selectedEventId == null
        ? undefined
        : displayEvents.find(
            (event) =>
              event.id === selectedEventId ||
              // Keep the editor open when an open non-recurring event gains a
              // recurrence rule: its occurrences get derived `baseId@@date` ids.
              event.baseId === selectedEventId,
          ),
    [displayEvents, selectedEventId],
  );

  // --- Navigation ----------------------------------------------------------

  const goToToday = useCallback(() => {
    setCurrentDate(
      view === "month"
        ? startOfMonth(new Date())
        : startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
    );
  }, [view]);

  const goToPrevious = useCallback(() => {
    setCurrentDate((date) =>
      view === "month" ? addMonths(date, -1) : addWeeks(date, -1),
    );
  }, [view]);

  const goToNext = useCallback(() => {
    setCurrentDate((date) =>
      view === "month" ? addMonths(date, 1) : addWeeks(date, 1),
    );
  }, [view]);

  const handleDateSelect = useCallback((date: Date) => {
    setCurrentDate(() =>
      view === "month"
        ? startOfMonth(date)
        : startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
    );
    setDatePickerOpen(false);
  }, [view]);

  /** Jump to a date (search results, month "+N more"): switch to week view. */
  const jumpToDate = useCallback(
    (date: Date, eventId?: string) => {
      setView("week");
      setCurrentDate(startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }));
      if (eventId) setSelectedEventId(eventId);
      setHighlightedDate(date);
      window.setTimeout(() => setHighlightedDate(null), 1500);
    },
    [],
  );

  // --- Event actions --------------------------------------------------------

  const handleEventDelete = useCallback(
    (event: CalendarEvent) => {
      deleteEvent(event);
      setSelectedEventId(null);
    },
    [deleteEvent],
  );

  const handleCreateEvent = useCallback(() => {
    const now = new Date();
    const todayInView = visibleDays.some((day) =>
      isWithinInterval(now, {
        start: day,
        end: new Date(day).setHours(23, 59, 59, 999),
      }),
    );

    const start = new Date();
    if (todayInView) {
      start.setMinutes(0, 0, 0);
      start.setHours(start.getHours() + 1);
    } else {
      const firstDay = visibleDays[0] ?? now;
      start.setFullYear(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate());
      start.setHours(9, 0, 0, 0);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    const defaultCalendar =
      calendars.find((c) => c.visible) ?? calendars[0];

    const newEvent: CalendarEvent = {
      id: createEventId(),
      title: "",
      start,
      end,
      calendarId: defaultCalendar?.id,
    };

    addEvent(newEvent);
    setSelectedEventId(newEvent.id);
  }, [visibleDays, addEvent, calendars]);

  /** Paste preserving the clipboard event's time-of-day on the target date. */
  const handlePaste = useCallback(
    (targetDate: Date, calendarId?: string) => {
      if (!clipboard) return;
      const start = new Date(targetDate);
      start.setHours(
        clipboard.event.start.getHours(),
        clipboard.event.start.getMinutes(),
        0,
        0,
      );
      const created = pasteEvent(start, calendarId);
      if (created) setSelectedEventId(created.id);
    },
    [clipboard, pasteEvent],
  );

  // --- Keyboard shortcuts: undo/redo + copy/paste/duplicate ----------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();

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
        handlePaste(selectedEvent?.start ?? currentDate);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, selectedEvent, copyEvent, duplicateEvent, clipboard, handlePaste, currentDate]);

  const calendarDataValue = useMemo(
    () => ({
      calendars,
      events,
      conflictIds,
      duplicateEvent: (event: CalendarEvent) => {
        const copy = duplicateEvent(event);
        setSelectedEventId(copy.id);
      },
      copyEvent,
      pasteEvent: handlePaste,
      hasClipboard: clipboard !== null,
      getCalendar: (id: string | undefined) =>
        calendars.find((c) => c.id === id),
    }),
    [
      calendars,
      events,
      conflictIds,
      duplicateEvent,
      copyEvent,
      handlePaste,
      clipboard,
    ],
  );

  return (
    <CalendarDataProvider value={calendarDataValue}>
      <main className="bg-background text-foreground flex h-svh min-h-0 flex-col overflow-hidden">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="text-sm font-semibold tracking-tight">Tempo</span>
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 transition-colors"
                  title="Choose a date"
                >
                  <h1 className="truncate text-xl font-semibold tracking-tight">
                    {monthName} {year}
                  </h1>
                  <ChevronDown className="text-muted-foreground size-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-0">
                <MiniCalendar
                  currentDate={headerDate}
                  visibleDays={view === "week" ? visibleDays : []}
                  onSelect={handleDateSelect}
                  weekStartsOn={WEEK_STARTS_ON}
                />
              </PopoverContent>
            </Popover>
            {view === "week" && (
              <span className="text-muted-foreground hidden text-xs sm:inline">
                Week {weekNumber}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <AgentPanel agent={agent} />
            <SearchPopover
              events={events}
              calendars={calendars}
              onSelectResult={(event) => jumpToDate(event.start, event.id)}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="size-4" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  {view === "week" ? "Week" : "Month"}
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => switchView("week")}>
                  Week
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => switchView("month")}>
                  Month
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="secondary" size="sm" onClick={handleCreateEvent}>
              <Plus className="size-4" />
              New event
            </Button>
            <Button variant="secondary" size="sm" onClick={goToToday}>
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={goToPrevious}
            >
              <ChevronLeft className="size-4" />
              <span className="sr-only">Previous</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              onClick={goToNext}
            >
              <ChevronRight className="size-4" />
              <span className="sr-only">Next</span>
            </Button>
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <CalendarSidebar
            calendars={calendars}
            events={events}
            addCalendar={store.addCalendar}
            updateCalendar={store.updateCalendar}
            deleteCalendar={(id) => {
              store.deleteCalendar(id);
              setSelectedEventId(null);
            }}
            importEvents={store.importEvents}
          />
          <div className="min-w-0 flex-1">
            {view === "week" ? (
              <WeekView
                view="week"
                currentDate={currentDate}
                events={displayEvents}
                selectedEventId={selectedEvent?.id}
                onEventClick={(event) => setSelectedEventId(event.id)}
                onBackgroundClick={() => setSelectedEventId(null)}
                onDateChange={setCurrentDate}
                onVisibleDaysChange={setVisibleDays}
                onEventChange={updateEvent}
                onEventDelete={handleEventDelete}
                onClosePopover={() => setSelectedEventId(null)}
                onPrevWeek={goToPrevious}
                onNextWeek={goToNext}
                highlightedDate={highlightedDate}
                isSidebarOpen={false}
              />
            ) : (
              <MonthView
                currentDate={currentDate}
                events={displayEvents}
                selectedEventId={selectedEvent?.id}
                onEventClick={(event) => setSelectedEventId(event.id)}
                onEventChange={updateEvent}
                onEventDelete={handleEventDelete}
                onNavigateToDate={(date) => jumpToDate(date)}
                onClosePopover={() => setSelectedEventId(null)}
              />
            )}
          </div>
        </div>
        {agent.pendingConfirmation && (
          <AgentConfirmDialog confirmation={agent.pendingConfirmation} />
        )}
      </main>
    </CalendarDataProvider>
  );
}
