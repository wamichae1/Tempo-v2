import { useCallback, useMemo, useState } from "react";
import { addWeeks, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  WeekView,
  getCalendarHeaderInfo,
  getVisibleDays,
  type CalendarEvent,
} from "@/components/calendar";
import { Button } from "@/components/ui/button";
import { generateMockEvents } from "@/lib/mock-events";

const WEEK_STARTS_ON = 0;

export function TempoCalendar() {
  const [currentDate, setCurrentDate] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
  );
  const [events, setEvents] = useState<CalendarEvent[]>(() =>
    generateMockEvents(),
  );
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [visibleDays, setVisibleDays] = useState<Date[]>(() =>
    getVisibleDays(currentDate, "week"),
  );

  const headerDate = visibleDays[0] ?? currentDate;
  const { monthName, year, weekNumber } = getCalendarHeaderInfo(
    headerDate,
    WEEK_STARTS_ON,
  );

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
  );

  const goToToday = useCallback(() => {
    setCurrentDate(startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }));
  }, []);

  const goToPreviousWeek = useCallback(() => {
    setCurrentDate((date) => addWeeks(date, -1));
  }, []);

  const goToNextWeek = useCallback(() => {
    setCurrentDate((date) => addWeeks(date, 1));
  }, []);

  const handleEventChange = useCallback((updatedEvent: CalendarEvent) => {
    setEvents((currentEvents) =>
      currentEvents.map((event) =>
        event.id === updatedEvent.id ? updatedEvent : event,
      ),
    );
  }, []);

  return (
    <main className="bg-background text-foreground flex h-svh min-h-0 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="text-sm font-semibold tracking-tight">Tempo</span>
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {monthName} {year}
          </h1>
          <span className="text-muted-foreground hidden text-xs sm:inline">
            Week {weekNumber}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" onClick={goToToday}>
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goToPreviousWeek}
          >
            <ChevronLeft className="size-4" />
            <span className="sr-only">Previous week</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={goToNextWeek}
          >
            <ChevronRight className="size-4" />
            <span className="sr-only">Next week</span>
          </Button>
        </div>
      </header>
      <WeekView
        view="week"
        currentDate={currentDate}
        events={events}
        selectedEventId={selectedEvent?.id}
        onEventClick={(event) => setSelectedEventId(event.id)}
        onBackgroundClick={() => setSelectedEventId(null)}
        onDateChange={setCurrentDate}
        onVisibleDaysChange={setVisibleDays}
        onEventChange={handleEventChange}
        onClosePopover={() => setSelectedEventId(null)}
        onPrevWeek={goToPreviousWeek}
        onNextWeek={goToNextWeek}
        isSidebarOpen={false}
      />
    </main>
  );
}
