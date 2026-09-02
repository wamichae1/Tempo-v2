import { addMonths } from "date-fns";

import type { CalendarEvent } from "@/components/calendar/week-view-types";
import { expandEvents } from "@/lib/recurrence";
import type { Calendar } from "@/features/calendar/types";

/** A single search result: an event (or occurrence) plus display metadata. */
export interface EventSearchResult {
  event: CalendarEvent;
  /** Name of the calendar the event belongs to. */
  calendarName: string;
}

export interface SearchEventsOptions {
  /** Restrict results to events on or after this date. */
  from?: Date;
  /** Restrict results to events before this date. */
  to?: Date;
  /** Maximum number of results (default 50). */
  limit?: number;
}

/**
 * Searches events by title, description, location and calendar name.
 *
 * Recurring series are expanded around the search window so a query like
 * "gym" can jump to a concrete upcoming occurrence. Pure and reusable —
 * the WebMCP `search_events` tool will call this directly.
 */
export function searchEvents(
  events: CalendarEvent[],
  calendars: Calendar[],
  query: string,
  options: SearchEventsOptions = {},
): EventSearchResult[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return [];

  const from = options.from ?? addMonths(new Date(), -6);
  const to = options.to ?? addMonths(new Date(), 12);
  const limit = options.limit ?? 50;

  const calendarNameById = new Map(calendars.map((c) => [c.id, c.name]));

  // Expand recurrence over the search window.
  const expanded = expandEvents(events, from, to);

  const matchesQuery = (event: CalendarEvent, calendarName: string) =>
    event.title.toLowerCase().includes(q) ||
    (event.description ?? "").toLowerCase().includes(q) ||
    (event.location ?? "").toLowerCase().includes(q) ||
    calendarName.toLowerCase().includes(q);

  const results: EventSearchResult[] = [];
  for (const event of expanded) {
    const calendarName = calendarNameById.get(event.calendarId ?? "") ?? "";
    if (!matchesQuery(event, calendarName)) continue;
    results.push({ event, calendarName });
    if (results.length >= limit * 4) break; // collect generously, then sort
  }

  // Soonest upcoming first, then past events in reverse chronological order.
  const now = Date.now();
  results.sort((a, b) => {
    const aUpcoming = a.event.end.getTime() >= now;
    const bUpcoming = b.event.end.getTime() >= now;
    if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
    return aUpcoming
      ? a.event.start.getTime() - b.event.start.getTime()
      : b.event.start.getTime() - a.event.start.getTime();
  });

  return results.slice(0, limit);
}
