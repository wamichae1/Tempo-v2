import * as React from "react";

import type { CalendarEvent } from "@/components/calendar";
import type { Calendar } from "@/features/calendar/types";

/**
 * Provides calendar metadata (list of calendars), conflict ids, and shared
 * event actions (duplicate / copy / paste) to deeply nested calendar
 * components (event items, context menus, detail panels) without threading
 * props through every layer of the week view.
 */
export interface CalendarDataContextValue {
  calendars: Calendar[];
  /** All stored (unexpanded) events — used e.g. for location suggestions. */
  events: CalendarEvent[];
  /** Ids of events currently in conflict (expanded occurrence ids). */
  conflictIds: Set<string>;
  duplicateEvent: (event: CalendarEvent) => void;
  copyEvent: (event: CalendarEvent) => void;
  /**
   * Paste the clipboard event. `targetDate` sets the day (time-of-day of the
   * copied event is preserved); `calendarId` optionally overrides the target
   * calendar.
   */
  pasteEvent: (targetDate: Date, calendarId?: string) => void;
  hasClipboard: boolean;
  /** Resolve a calendar by id. */
  getCalendar: (id: string | undefined) => Calendar | undefined;
  /** Update a calendar (rename / recolor / visibility). */
  updateCalendar: (calendar: Calendar) => void;
}

const CalendarDataContext = React.createContext<CalendarDataContextValue>({
  calendars: [],
  events: [],
  conflictIds: new Set(),
  duplicateEvent: () => {},
  copyEvent: () => {},
  pasteEvent: () => {},
  hasClipboard: false,
  getCalendar: () => undefined,
  updateCalendar: () => {},
});

export function CalendarDataProvider({
  value,
  children,
}: {
  value: CalendarDataContextValue;
  children: React.ReactNode;
}) {
  return (
    <CalendarDataContext.Provider value={value}>
      {children}
    </CalendarDataContext.Provider>
  );
}

export function useCalendarData(): CalendarDataContextValue {
  return React.useContext(CalendarDataContext);
}
