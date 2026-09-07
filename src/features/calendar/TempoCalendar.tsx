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
  WeekView,
  getCalendarHeaderInfo,
  getVisibleDays,
  type CalendarEvent,
  type ViewType,
} from "@/components/calendar";
import { MiniCalendar } from "@/components/calendar/mini-calendar";
import { MonthView } from "@/components/calendar/month-view";
import {
  createEventId,
  useCalendarEvents,
} from "@/features/calendar/use-calendar-events";
import { CalendarDataProvider } from "@/features/calendar/calendar-data-context";
import { CalendarSidebar } from "@/features/calendar/calendar-sidebar";
import { CalendarHeader } from "@/features/calendar/calendar-header";
import { useCalendarShortcuts } from "@/features/calendar/use-calendar-shortcuts";
import { WorkspaceLayout } from "@/features/workspace/workspace-layout";
import { AgentPanel } from "@/features/agent/agent-panel";
import { useAgentTools } from "@/features/agent/use-agent-tools";
import { AgentConfirmDialog } from "@/features/agent/agent-confirm-dialog";
import { IntroOverlay } from "@/features/intro/intro-overlay";
import { useIntro } from "@/features/intro/use-intro";
import { useTheme } from "@/hooks/use-theme";
import { expandEvents } from "@/lib/recurrence";
import { findConflictingEventIds } from "@/lib/conflicts";

const WEEK_STARTS_ON = 0 as const;
const LS_VIEW = "tempo:view";
const LS_PANELS = "tempo:panels";

type MainView = Extract<ViewType, "week" | "month">;

interface PanelState {
  sidebar: boolean;
  assistant: boolean;
}

function loadPanelState(): PanelState {
  try {
    const raw = localStorage.getItem(LS_PANELS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PanelState>;
      return {
        sidebar: parsed.sidebar !== false,
        assistant: parsed.assistant !== false,
      };
    }
  } catch {
    // fall through to defaults
  }
  // Small screens: start with both panels collapsed to prioritize the
  // calendar; the user can open them as overlays-width panels.
  if (typeof window !== "undefined" && window.innerWidth < 1024) {
    return { sidebar: false, assistant: false };
  }
  return { sidebar: true, assistant: true };
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
  const { theme, cycleTheme } = useTheme();
  const { introOpen, dismissIntro, reopenIntro } = useIntro();
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
  /** The user's explicitly selected day (sidebar mini calendar highlight).
   *  Only changes on explicit date selection or "Today" — never on
   *  prev/next navigation or week/month view changes. */
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());
  const [visibleDays, setVisibleDays] = useState<Date[]>(() =>
    getVisibleDays(currentDate, "week"),
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [highlightedDate, setHighlightedDate] = useState<Date | null>(null);
  const [panels, setPanels] = useState<PanelState>(loadPanelState);

  useEffect(() => {
    localStorage.setItem(LS_VIEW, view);
  }, [view]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_PANELS, JSON.stringify(panels));
    } catch {
      // storage unavailable — keep in memory
    }
  }, [panels]);

  const toggleSidebar = useCallback(
    () => setPanels((p) => ({ ...p, sidebar: !p.sidebar })),
    [],
  );
  const toggleAssistant = useCallback(
    () => setPanels((p) => ({ ...p, assistant: !p.assistant })),
    [],
  );

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

    // Calendar color is the event's visual identity: it always wins over a
    // stored per-event color. The event's own color is kept in the data model
    // (ICS round-trip) and used only as a fallback when the calendar is gone.
    return expandEvents(events, rangeStart, rangeEnd)
      .filter((e) => !hiddenCalendars.has(e.calendarId ?? ""))
      .map((e): CalendarEvent => {
        const calendarColor = colorByCalendar.get(e.calendarId ?? "");
        if (calendarColor && calendarColor !== e.color) {
          return { ...e, color: calendarColor };
        }
        return e.color ? e : { ...e, color: "blue" };
      });
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
    setSelectedDay(new Date());
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
    setSelectedDay(date);
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
      setSelectedDay(date);
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

  // --- Keyboard shortcuts ---------------------------------------------------

  useCalendarShortcuts({
    undo,
    redo,
    selectedEvent,
    copyEvent,
    duplicateEvent,
    clipboard,
    paste: () => handlePaste(selectedEvent?.start ?? currentDate),
    toggleSidebar,
    toggleAssistant,
  });

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
      updateCalendar: store.updateCalendar,
    }),
    [
      calendars,
      events,
      conflictIds,
      store.updateCalendar,
      duplicateEvent,
      copyEvent,
      handlePaste,
      clipboard,
    ],
  );

  return (
    <CalendarDataProvider value={calendarDataValue}>
      <main className="bg-background text-foreground flex h-svh min-h-0 flex-col overflow-hidden">
        <CalendarHeader
          view={view}
          monthName={monthName}
          year={year}
          weekNumber={weekNumber}
          headerDate={headerDate}
          visibleDays={visibleDays}
          weekStartsOn={WEEK_STARTS_ON}
          datePickerOpen={datePickerOpen}
          onDatePickerOpenChange={setDatePickerOpen}
          onDateSelect={handleDateSelect}
          onSwitchView={switchView}
          onCreateEvent={handleCreateEvent}
          onToday={goToToday}
          onPrevious={goToPrevious}
          onNext={goToNext}
          undo={undo}
          redo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          events={events}
          calendars={calendars}
          onSelectSearchResult={(event) => jumpToDate(event.start, event.id)}
          theme={theme}
          onCycleTheme={cycleTheme}
          onToggleSidebar={toggleSidebar}
          onToggleAssistant={toggleAssistant}
          onShowIntro={reopenIntro}
        />
        <WorkspaceLayout
          sidebarCollapsed={!panels.sidebar}
          assistantCollapsed={!panels.assistant}
          onSidebarCollapsedChange={(collapsed) =>
            setPanels((p) => ({ ...p, sidebar: !collapsed }))
          }
          onAssistantCollapsedChange={(collapsed) =>
            setPanels((p) => ({ ...p, assistant: !collapsed }))
          }
          sidebar={
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
              miniCalendar={
                <MiniCalendar
                  currentDate={currentDate}
                  visibleDays={[]}
                  selectedDate={selectedDay}
                  onSelect={(date) => jumpToDate(date)}
                  weekStartsOn={WEEK_STARTS_ON}
                  className="w-full max-w-[220px] p-0"
                />
              }
            />
          }
          assistant={<AgentPanel agent={agent} onClose={toggleAssistant} />}
        >
          <div className="min-h-0 min-w-0 flex-1">
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
                // The left workspace sidebar is a calendar list, not the
                // event-detail sidebar this flag refers to — keep false so the
                // detail popover opens on selection.
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
        </WorkspaceLayout>
        {agent.pendingConfirmation && (
          <AgentConfirmDialog confirmation={agent.pendingConfirmation} />
        )}
        {introOpen && <IntroOverlay onDismiss={dismissIntro} />}
      </main>
    </CalendarDataProvider>
  );
}
