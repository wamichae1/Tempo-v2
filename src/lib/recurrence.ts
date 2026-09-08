import { addDays, differenceInCalendarDays, startOfDay } from "date-fns";

import type { CalendarEvent } from "@/components/calendar/week-view-types";

/**
 * Structured recurrence rule for an event.
 *
 * Intentionally mirrors a practical subset of iCalendar RRULE
 * (RFC 5545 §3.3.10) so it can be serialized to / parsed from ICS and later
 * manipulated by WebMCP tools without lossy conversions.
 */
export interface RecurrenceRule {
  /** Frequency of the recurrence. */
  freq: "daily" | "weekly" | "monthly";
  /** Interval between occurrences (default 1). */
  interval?: number;
  /**
   * Days of the week the event occurs on (0 = Sunday … 6 = Saturday).
   * Only meaningful for weekly rules; omitted means "same weekday as start".
   */
  byWeekDays?: number[];
  /** Inclusive end date (ISO date string, yyyy-mm-dd). */
  until?: string;
  /** Maximum number of occurrences. */
  count?: number;
}

/** Separator used to build occurrence ids: `${baseId}@@${isoStart}`. */
export const OCCURRENCE_ID_SEPARATOR = "@@";

const WEEKDAY_TOKENS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

/** Hard cap on occurrences generated for a single series in one expansion. */
export const MAX_RECURRENCE_OCCURRENCES = 500;
/** Hard cap on days scanned while expanding (safety for pathological rules). */
export const RECURRENCE_EXPANSION_DAYS = 366 * 20;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Formats a Date as a local ISO date (yyyy-mm-dd) for `until` storage. */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Serializes a RecurrenceRule to an iCalendar RRULE value (without prefix). */
export function recurrenceToRRule(rule: RecurrenceRule): string {
  const parts: string[] = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval && rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }
  if (rule.byWeekDays && rule.byWeekDays.length > 0) {
    const days = [...rule.byWeekDays]
      .sort((a, b) => a - b)
      .map((d) => WEEKDAY_TOKENS[d])
      .filter(Boolean);
    if (days.length > 0) {
      parts.push(`BYDAY=${days.join(",")}`);
    }
  }
  if (rule.until) {
    parts.push(`UNTIL=${rule.until.replace(/-/g, "")}`);
  }
  if (rule.count && rule.count > 0) {
    parts.push(`COUNT=${rule.count}`);
  }
  return parts.join(";");
}

/**
 * Parses an iCalendar RRULE value into a RecurrenceRule.
 * Returns null for unsupported frequencies. Unknown parts are ignored.
 */
export function parseRRule(value: string): RecurrenceRule | null {
  const parts = value.split(";");
  const map = new Map<string, string>();
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    map.set(part.slice(0, idx).trim().toUpperCase(), part.slice(idx + 1).trim());
  }

  const freqRaw = map.get("FREQ")?.toLowerCase();
  if (freqRaw !== "daily" && freqRaw !== "weekly" && freqRaw !== "monthly") {
    return null;
  }

  const rule: RecurrenceRule = { freq: freqRaw };

  const interval = Number.parseInt(map.get("INTERVAL") ?? "", 10);
  if (!Number.isNaN(interval) && interval > 1) {
    rule.interval = interval;
  }

  const byday = map.get("BYDAY");
  if (byday) {
    const days = byday
      .split(",")
      .map((token) => WEEKDAY_TOKENS.indexOf(token.trim().toUpperCase() as (typeof WEEKDAY_TOKENS)[number]))
      .filter((d) => d >= 0);
    if (days.length > 0) {
      rule.byWeekDays = days;
    }
  }

  const until = map.get("UNTIL");
  if (until && /^\d{8}/.test(until)) {
    const y = until.slice(0, 4);
    const m = until.slice(4, 6);
    const d = until.slice(6, 8);
    rule.until = `${y}-${m}-${d}`;
  }

  const count = Number.parseInt(map.get("COUNT") ?? "", 10);
  if (!Number.isNaN(count) && count > 0) {
    rule.count = count;
  }

  return rule;
}

/** True when the rule represents "every weekday" (Mon–Fri weekly). */
export function isWeekdayRule(rule: RecurrenceRule): boolean {
  return (
    rule.freq === "weekly" &&
    (rule.interval ?? 1) === 1 &&
    !!rule.byWeekDays &&
    rule.byWeekDays.length === 5 &&
    [1, 2, 3, 4, 5].every((d) => rule.byWeekDays!.includes(d))
  );
}

/** Human readable label, e.g. "Every week on Tue, Thu". */
export function describeRecurrence(rule: RecurrenceRule, start: Date): string {
  const interval = rule.interval ?? 1;
  let base: string;

  if (rule.freq === "daily") {
    base = interval === 1 ? "Daily" : `Every ${interval} days`;
  } else if (rule.freq === "weekly") {
    const days =
      rule.byWeekDays && rule.byWeekDays.length > 0
        ? rule.byWeekDays
        : [start.getDay()];
    const names = [...days]
      .sort((a, b) => a - b)
      .map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d])
      .join(", ");
    if (interval === 1) {
      base = isWeekdayRule(rule)
        ? "Every weekday (Mon–Fri)"
        : `Weekly on ${names}`;
    } else {
      base = `Every ${interval} weeks on ${names}`;
    }
  } else {
    base =
      interval === 1
        ? `Monthly on day ${start.getDate()}`
        : `Every ${interval} months on day ${start.getDate()}`;
  }

  if (rule.until) {
    const [y, m, d] = rule.until.split("-").map(Number);
    base += `, until ${new Date(y, m - 1, d).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`;
  } else if (rule.count) {
    base += `, ${rule.count} times`;
  }

  return base;
}

/** Tests whether a candidate day matches the rule relative to the series start. */
function matchesRule(rule: RecurrenceRule, seriesStart: Date, day: Date): boolean {
  const interval = rule.interval ?? 1;
  if (rule.freq === "daily") {
    return differenceInCalendarDays(day, seriesStart) % interval === 0;
  }
  if (rule.freq === "weekly") {
    const weekDiff = Math.floor(
      differenceInCalendarDays(startOfDay(day), startOfDay(seriesStart)) / 7,
    );
    if (weekDiff % interval !== 0) return false;
    const days =
      rule.byWeekDays && rule.byWeekDays.length > 0
        ? rule.byWeekDays
        : [seriesStart.getDay()];
    return days.includes(day.getDay());
  }
  // monthly: same day-of-month
  const monthDiff =
    (day.getFullYear() - seriesStart.getFullYear()) * 12 +
    (day.getMonth() - seriesStart.getMonth());
  return monthDiff % interval === 0 && day.getDate() === seriesStart.getDate();
}

/**
 * Expands an event into concrete occurrences overlapping [rangeStart, rangeEnd].
 *
 * Non-recurring events are returned as-is when they overlap the range.
 * Recurring events produce one cloned event per occurrence; each clone carries
 * a derived id (`baseId@@isoStart`), plus `baseId` / `occurrenceStart` fields
 * so the store can map edits back onto the series.
 */
export function expandEventOccurrences(
  event: CalendarEvent,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const rule = event.rrule;
  if (!rule) {
    return event.start < rangeEnd && event.end > rangeStart ? [event] : [];
  }

  const duration = event.end.getTime() - event.start.getTime();
  const seriesStartDay = startOfDay(event.start);
  const untilDay = rule.until ? new Date(`${rule.until}T23:59:59`) : null;
  const results: CalendarEvent[] = [];

  // Scan from the series start day so COUNT applies to the whole series.
  let day = seriesStartDay;
  let produced = 0;
  let scanned = 0;

  while (scanned < RECURRENCE_EXPANSION_DAYS) {
    scanned += 1;
    if (untilDay && day > untilDay) break;
    // Occurrences far beyond the visible range are not needed.
    if (day > rangeEnd && (!rule.count || produced >= rule.count)) break;

    if (matchesRule(rule, event.start, day)) {
      produced += 1;
      if (rule.count && produced > rule.count) break;

      const occStart = new Date(day);
      occStart.setHours(
        event.start.getHours(),
        event.start.getMinutes(),
        event.start.getSeconds(),
        0,
      );
      const occEnd = new Date(occStart.getTime() + duration);

      if (occEnd > rangeStart && occStart < rangeEnd) {
        results.push({
          ...event,
          id: `${event.id}${OCCURRENCE_ID_SEPARATOR}${occStart.toISOString()}`,
          start: occStart,
          end: occEnd,
          baseId: event.id,
          occurrenceStart: occStart,
        });
      }
    }

    if (produced >= MAX_RECURRENCE_OCCURRENCES) break;
    day = addDays(day, 1);
  }

  return results;
}

/**
 * Expands a list of events over a range. Recurring events become occurrences,
 * plain events pass through when they overlap the range.
 */
export function expandEvents(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const event of events) {
    out.push(...expandEventOccurrences(event, rangeStart, rangeEnd));
  }
  return out;
}

/**
 * Maps an edited occurrence back onto its base series event.
 * - If the event has no `baseId`, it is returned unchanged.
 * - Otherwise the start/end delta of the occurrence is applied to the base
 *   event (editing an occurrence edits the whole series).
 */
export function occurrenceEditToSeries(
  occurrence: CalendarEvent,
  base: CalendarEvent,
): CalendarEvent {
  if (!occurrence.baseId || !occurrence.occurrenceStart) {
    return occurrence;
  }
  const delta = occurrence.start.getTime() - occurrence.occurrenceStart.getTime();
  const { baseId: _b, occurrenceStart: _o, id: _id, ...rest } = occurrence;
  return {
    ...base,
    ...rest,
    id: base.id,
    start: new Date(base.start.getTime() + delta),
    end: new Date(base.end.getTime() + delta),
  };
}
