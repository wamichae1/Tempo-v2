import { areIntervalsOverlapping } from "date-fns";

import type { CalendarEvent } from "@/components/calendar/week-view-types";

export interface EventConflictPair {
  first: CalendarEvent;
  second: CalendarEvent;
}

/** Returns every pair of overlapping timed events. */
export function findEventConflictPairs(
  events: CalendarEvent[],
): EventConflictPair[] {
  const timed = events.filter((e) => !e.isAllDay);
  const sorted = [...timed].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const pairs: EventConflictPair[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const first = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const second = sorted[j];
      if (second.start >= first.end) break;
      if (
        areIntervalsOverlapping(
          { start: first.start, end: first.end },
          { start: second.start, end: second.end },
        )
      ) {
        pairs.push({ first, second });
      }
    }
  }

  return pairs;
}

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
  const conflicts = new Set<string>();
  for (const { first, second } of findEventConflictPairs(events)) {
    conflicts.add(first.id);
    conflicts.add(second.id);
  }
  return conflicts;
}
