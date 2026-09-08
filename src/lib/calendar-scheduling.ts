import { addDays, addMinutes, startOfDay } from "date-fns";

import type { CalendarEvent } from "@/components/calendar";
import { findEventConflictPairs, type EventConflictPair } from "@/lib/conflicts";
import {
  describeRecurrence,
  expandEventOccurrences,
  expandEvents,
  OCCURRENCE_ID_SEPARATOR,
  RECURRENCE_EXPANSION_DAYS,
} from "@/lib/recurrence";

export interface TimeWindow {
  start: Date;
  end: Date;
  availableMinutes: number;
}

export interface FreeTimeOptions {
  rangeStart: Date;
  rangeEnd: Date;
  durationMinutes: number;
  calendarIds?: readonly string[];
  preferredStartMinutes?: number;
  preferredEndMinutes?: number;
}

export interface ResolvedPushAnchor {
  base: CalendarEvent;
  occurrence: CalendarEvent;
}

export interface PushPlan {
  anchor: CalendarEvent;
  updates: CalendarEvent[];
  wholeSeriesIds: string[];
  skippedAllDay: CalendarEvent[];
  conflicts: EventConflictPair[];
  scopeStart: Date;
  scopeEnd: Date;
  conflictCheckStart: Date;
  conflictCheckEnd: Date;
  fingerprint: string;
}

export interface PushPlanOptions {
  anchor: ResolvedPushAnchor;
  offsetMinutes: number;
  scopeStart: Date;
  scopeEnd: Date;
  calendarIds?: readonly string[];
}

function maxDate(first: Date, second: Date): Date {
  return first > second ? first : second;
}

function minDate(first: Date, second: Date): Date {
  return first < second ? first : second;
}

function atLocalMinutes(day: Date, minutes: number): Date {
  const value = startOfDay(day);
  value.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return value;
}

function mergeIntervals(
  intervals: Array<{ start: Date; end: Date }>,
): Array<{ start: Date; end: Date }> {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: Array<{ start: Date; end: Date }> = [];
  for (const interval of sorted) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end) {
      if (interval.end > last.end) last.end = interval.end;
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  return merged;
}

function busyInterval(event: CalendarEvent): { start: Date; end: Date } {
  if (!event.isAllDay) {
    return { start: event.start, end: event.end };
  }
  return {
    start: startOfDay(event.start),
    // Tempo stores all-day end dates inclusively, with either midnight or 23:59.
    end: addDays(startOfDay(event.end), 1),
  };
}

function searchSegments(options: FreeTimeOptions): Array<{ start: Date; end: Date }> {
  const { rangeStart, rangeEnd, preferredStartMinutes, preferredEndMinutes } = options;
  if (preferredStartMinutes === undefined || preferredEndMinutes === undefined) {
    return [{ start: rangeStart, end: rangeEnd }];
  }
  const segments: Array<{ start: Date; end: Date }> = [];
  for (let day = startOfDay(rangeStart); day < rangeEnd; day = addDays(day, 1)) {
    const start = maxDate(rangeStart, atLocalMinutes(day, preferredStartMinutes));
    const end = minDate(rangeEnd, atLocalMinutes(day, preferredEndMinutes));
    if (end > start) segments.push({ start, end });
  }
  return segments;
}

/** Finds maximal free windows using Tempo's local Date semantics. */
export function findFreeTime(
  events: CalendarEvent[],
  options: FreeTimeOptions,
): TimeWindow[] {
  const selectedCalendars = options.calendarIds
    ? new Set(options.calendarIds)
    : null;
  // Widen the lower bound so zero-duration midnight all-day records still
  // materialize and can be normalized to Tempo's inclusive all-day span.
  const expanded = expandEvents(
    events,
    addDays(startOfDay(options.rangeStart), -1),
    options.rangeEnd,
  );
  const busy = mergeIntervals(
    expanded
      .filter(
        (event) =>
          event.status !== "free" &&
          (!selectedCalendars || selectedCalendars.has(event.calendarId ?? "")),
      )
      .map(busyInterval)
      .map((interval) => ({
        start: maxDate(interval.start, options.rangeStart),
        end: minDate(interval.end, options.rangeEnd),
      })),
  );

  const minimumMs = options.durationMinutes * 60_000;
  const windows: TimeWindow[] = [];
  for (const segment of searchSegments(options)) {
    let cursor = segment.start;
    for (const interval of busy) {
      if (interval.end <= cursor || interval.start >= segment.end) continue;
      const clippedStart = maxDate(interval.start, segment.start);
      if (clippedStart.getTime() - cursor.getTime() >= minimumMs) {
        windows.push({
          start: new Date(cursor),
          end: new Date(clippedStart),
          availableMinutes: Math.floor(
            (clippedStart.getTime() - cursor.getTime()) / 60_000,
          ),
        });
      }
      if (interval.end > cursor) cursor = minDate(interval.end, segment.end);
      if (cursor >= segment.end) break;
    }
    if (segment.end.getTime() - cursor.getTime() >= minimumMs) {
      windows.push({
        start: new Date(cursor),
        end: new Date(segment.end),
        availableMinutes: Math.floor(
          (segment.end.getTime() - cursor.getTime()) / 60_000,
        ),
      });
    }
  }
  return windows.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** Resolves an event id, requiring an exact occurrence id for recurring anchors. */
export function resolvePushAnchor(
  events: CalendarEvent[],
  eventId: string,
): ResolvedPushAnchor | null | "recurring-occurrence-required" {
  const separatorIndex = eventId.indexOf(OCCURRENCE_ID_SEPARATOR);
  const baseId = separatorIndex === -1 ? eventId : eventId.slice(0, separatorIndex);
  const base = events.find((event) => event.id === baseId);
  if (!base) return null;
  if (!base.rrule) return separatorIndex === -1 ? { base, occurrence: base } : null;
  if (separatorIndex === -1) return "recurring-occurrence-required";

  const occurrenceStart = new Date(
    eventId.slice(separatorIndex + OCCURRENCE_ID_SEPARATOR.length),
  );
  if (Number.isNaN(occurrenceStart.getTime())) return null;
  const duration = base.end.getTime() - base.start.getTime();
  const matches = expandEventOccurrences(
    base,
    new Date(occurrenceStart.getTime() - Math.max(duration, 1)),
    new Date(occurrenceStart.getTime() + Math.max(duration, 1)),
  );
  const occurrence = matches.find((event) => event.id === eventId);
  return occurrence ? { base, occurrence } : null;
}

function baseIdOf(event: CalendarEvent): string {
  return event.baseId ?? event.id;
}

function fingerprintPlan(
  anchor: CalendarEvent,
  occurrences: CalendarEvent[],
): string {
  return JSON.stringify({
    anchor: [anchor.id, anchor.start.toISOString(), anchor.end.toISOString()],
    candidates: occurrences
      .map((event) => [
        baseIdOf(event),
        event.start.toISOString(),
        event.end.toISOString(),
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
  });
}

/** Plans a push without mutating the supplied master-event array. */
export function planEventPush(
  events: CalendarEvent[],
  options: PushPlanOptions,
): PushPlan {
  const calendarIds = options.calendarIds
    ? new Set(options.calendarIds)
    : new Set([options.anchor.base.calendarId ?? ""]);
  const occurrences = expandEvents(events, options.scopeStart, options.scopeEnd)
    .filter((event) => calendarIds.has(event.calendarId ?? ""))
    .filter((event) => event.start >= options.scopeStart)
    .filter((event) => baseIdOf(event) !== options.anchor.base.id);
  const skippedAllDay = occurrences.filter((event) => event.isAllDay);
  const candidates = occurrences.filter((event) => !event.isAllDay);

  const candidateBaseIds = new Set(candidates.map(baseIdOf));
  const updates = events
    .filter((event) => candidateBaseIds.has(event.id))
    .map((event) => {
      const start = addMinutes(event.start, options.offsetMinutes);
      const end = addMinutes(event.end, options.offsetMinutes);
      return {
        ...event,
        start,
        end,
        recurrence: event.rrule
          ? describeRecurrence(event.rrule, start)
          : event.recurrence,
      };
    });
  const updateIds = new Set(updates.map((event) => event.id));
  const proposed = events.map(
    (event) => updates.find((update) => update.id === event.id) ?? event,
  );

  const shiftedScopeStart = addMinutes(options.scopeStart, options.offsetMinutes);
  const shiftedScopeEnd = addMinutes(options.scopeEnd, options.offsetMinutes);
  let conflictCheckStart = minDate(options.scopeStart, shiftedScopeStart);
  let conflictCheckEnd = maxDate(options.scopeEnd, shiftedScopeEnd);
  for (const event of updates) {
    if (!event.rrule) continue;
    conflictCheckStart = minDate(conflictCheckStart, event.start);
    conflictCheckEnd = maxDate(
      conflictCheckEnd,
      addDays(event.start, RECURRENCE_EXPANSION_DAYS),
    );
  }

  const expandedProposed = expandEvents(
    proposed,
    conflictCheckStart,
    conflictCheckEnd,
  ).filter((event) => event.status !== "free");
  const conflicts = findEventConflictPairs(expandedProposed).filter(
    ({ first, second }) => {
      const firstChanged = updateIds.has(baseIdOf(first));
      const secondChanged = updateIds.has(baseIdOf(second));
      return firstChanged !== secondChanged;
    },
  );

  return {
    anchor: options.anchor.occurrence,
    updates,
    wholeSeriesIds: updates.filter((event) => event.rrule).map((event) => event.id),
    skippedAllDay,
    conflicts,
    scopeStart: options.scopeStart,
    scopeEnd: options.scopeEnd,
    conflictCheckStart,
    conflictCheckEnd,
    fingerprint: fingerprintPlan(options.anchor.occurrence, occurrences),
  };
}
