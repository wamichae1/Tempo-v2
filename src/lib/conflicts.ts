import { areIntervalsOverlapping } from "date-fns";

import type { CalendarEvent } from "@/components/calendar/week-view-types";

/**
 * Detects overlapping timed events.
 *
 * All-day events are ignored (they don't "conflict" in the scheduling sense).
 * Works on already-expanded occurrences, so recurring events are handled.
 *
 * Returns the set of event ids that overlap at least one other timed event.
 * Kept as a pure function so it can be reused by the UI (highlighting) and
 * later by the WebMCP `check_conflicts` tool.
 */
export function findConflictingEventIds(
  events: CalendarEvent[],
): Set<string> {
  const timed = events.filter((e) => !e.isAllDay);
  const conflicts = new Set<string>();

  // Sort by start so we can stop early once we pass an event's end.
  const sorted = [...timed].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.start >= a.end) break;
      if (
        areIntervalsOverlapping(
          { start: a.start, end: a.end },
          { start: b.start, end: b.end },
        )
      ) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }

  return conflicts;
}
