import type { EventColor } from "@/components/calendar/week-view-types";

/**
 * A user-created calendar (e.g. Personal, University, Work).
 * Events belong to exactly one calendar via `CalendarEvent.calendarId`.
 */
export interface Calendar {
  id: string;
  name: string;
  color: EventColor;
  /** Whether events on this calendar are shown in the views. */
  visible: boolean;
}

export const EVENT_COLORS: EventColor[] = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
];

/** Approximate hex used for ICS COLOR export / nearest-color import. */
export const EVENT_COLOR_HEX: Record<EventColor, string> = {
  red: "#EE000E",
  orange: "#FE7132",
  yellow: "#F2B827",
  green: "#49CA81",
  blue: "#32A5E5",
  purple: "#9950FF",
  gray: "#808080",
};

let calendarIdCounter = 0;

/** Generates a unique id for a locally created calendar. */
export function createCalendarId(): string {
  calendarIdCounter += 1;
  return `cal-${Date.now().toString(36)}-${calendarIdCounter}`;
}

/** Default calendars created on first run. */
export function createDefaultCalendars(): Calendar[] {
  return [
    { id: "cal-personal", name: "Personal", color: "purple", visible: true },
    { id: "cal-university", name: "University", color: "green", visible: true },
    { id: "cal-work", name: "Work", color: "blue", visible: true },
  ];
}
