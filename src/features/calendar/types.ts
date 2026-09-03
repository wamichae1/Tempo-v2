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
  "teal",
  "cyan",
  "blue",
  "indigo",
  "purple",
  "pink",
  "gray",
];

/** Approximate hex used for ICS COLOR export / nearest-color import. */
export const EVENT_COLOR_HEX: Record<EventColor, string> = {
  red: "#EE000E",
  orange: "#FE7132",
  yellow: "#F2B827",
  green: "#49CA81",
  teal: "#14B8A6",
  cyan: "#06B6D4",
  blue: "#32A5E5",
  indigo: "#6366F1",
  purple: "#9950FF",
  pink: "#EC4899",
  gray: "#808080",
};

/**
 * Tailwind class for a small filled color dot/swatch per event color.
 * Shared by the sidebar calendar list, event detail panel calendar picker,
 * and the event context menu so every surface shows the same identity color.
 */
export const EVENT_COLOR_DOT_CLASS: Record<EventColor, string> = {
  red: "bg-event-red-border",
  orange: "bg-event-orange-border",
  yellow: "bg-event-yellow-border",
  green: "bg-event-green-border",
  teal: "bg-event-teal-border",
  cyan: "bg-event-cyan-border",
  blue: "bg-event-blue-border",
  indigo: "bg-event-indigo-border",
  purple: "bg-event-purple-border",
  pink: "bg-event-pink-border",
  gray: "bg-event-gray-border",
};

let calendarIdCounter = 0;

/** Generates a unique id for a locally created calendar. */
export function createCalendarId(): string {
  calendarIdCounter += 1;
  return `cal-${Date.now().toString(36)}-${calendarIdCounter}`;
}

/**
 * Fresh installs start with no calendars — the user creates their own.
 * Existing users' calendars are restored from localStorage and are never
 * touched by this path.
 */
export function createDefaultCalendars(): Calendar[] {
  return [];
}
