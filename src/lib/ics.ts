import type { CalendarEvent, EventColor } from "@/components/calendar/week-view-types";
import type { Calendar } from "@/features/calendar/types";
import { EVENT_COLOR_HEX } from "@/features/calendar/types";
import {
  parseRRule,
  recurrenceToRRule,
  toISODate,
  type RecurrenceRule,
} from "@/lib/recurrence";

/**
 * Minimal, dependency-free iCalendar (RFC 5545 subset) import/export.
 * Everything runs locally in the browser.
 */

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Local floating date-time: 20260315T143000 */
function formatLocalDateTime(date: Date): string {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Parses `yyyyMMdd` or `yyyyMMddTHHmmss` (optionally trailing Z) into a local Date. */
function parseICSDate(raw: string, isDateOnly: boolean): Date | null {
  const m = raw.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  if (isDateOnly || h === undefined) {
    return new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0);
  }
  if (raw.endsWith("Z")) {
    // Convert UTC to a local Date.
    return new Date(
      Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)),
    );
  }
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\;/g, ";")
    .replace(/\\,/g, ",")
    .replace(/\\\\/g, "\\");
}

/** Folds a content line to 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  const limit = 75;
  if (line.length <= limit) return line;
  const parts: string[] = [line.slice(0, limit)];
  let rest = line.slice(limit);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, limit - 1));
    rest = rest.slice(limit - 1);
  }
  return parts.join("\r\n");
}

/** Splits unfolded content into logical lines. */
function unfoldLines(text: string): string[] {
  const raw = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim().length > 0) {
      lines.push(line);
    }
  }
  return lines;
}

/** Splits a content line into { name, params, value }. */
function parseContentLine(line: string): {
  name: string;
  params: Record<string, string>;
  value: string;
} {
  const colon = line.indexOf(":");
  const head = colon === -1 ? line : line.slice(0, colon);
  const value = colon === -1 ? "" : line.slice(colon + 1);
  const segments = head.split(";");
  const name = segments[0].toUpperCase();
  const params: Record<string, string> = {};
  for (const seg of segments.slice(1)) {
    const eq = seg.indexOf("=");
    if (eq === -1) continue;
    params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1);
  }
  return { name, params, value };
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const NAMED_COLORS: Record<string, EventColor> = {
  red: "red",
  orange: "orange",
  yellow: "yellow",
  green: "green",
  blue: "blue",
  purple: "purple",
  gray: "gray",
  grey: "gray",
};

/** Maps an ICS COLOR value (name or hex) to the nearest Tempo EventColor. */
export function icsColorToEventColor(value: string): EventColor | undefined {
  const named = NAMED_COLORS[value.trim().toLowerCase()];
  if (named) return named;

  const hexMatch = value.trim().match(/^#?([0-9a-fA-F]{6})$/);
  if (!hexMatch) return undefined;
  const r = parseInt(hexMatch[1].slice(0, 2), 16);
  const g = parseInt(hexMatch[1].slice(2, 4), 16);
  const b = parseInt(hexMatch[1].slice(4, 6), 16);

  let best: EventColor = "blue";
  let bestDist = Infinity;
  for (const [color, hex] of Object.entries(EVENT_COLOR_HEX) as [EventColor, string][]) {
    const er = parseInt(hex.slice(1, 3), 16);
    const eg = parseInt(hex.slice(3, 5), 16);
    const eb = parseInt(hex.slice(5, 7), 16);
    const dist = (r - er) ** 2 + (g - eg) ** 2 + (b - eb) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ParsedICSEvent {
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  description?: string;
  location?: string;
  rrule?: RecurrenceRule;
  color?: EventColor;
  uid?: string;
}

export interface ParsedICS {
  /** X-WR-CALNAME of the source file, if present. */
  calendarName?: string;
  /** X-WR-CALCOLOR / COLOR of the source calendar, if present. */
  calendarColor?: EventColor;
  events: ParsedICSEvent[];
  /** Human-readable warnings for skipped/malformed entries. */
  warnings: string[];
}

/**
 * Parses ICS text into events. Malformed VEVENTs are skipped with warnings
 * instead of failing the whole import.
 */
export function parseICS(text: string): ParsedICS {
  const lines = unfoldLines(text);
  const result: ParsedICS = { events: [], warnings: [] };

  let inEvent = false;
  let current: Record<string, { params: Record<string, string>; value: string }> = {};
  let eventIndex = 0;

  const flush = () => {
    eventIndex += 1;
    const get = (name: string) => current[name]?.value;
    const summary = get("SUMMARY") ? unescapeText(get("SUMMARY")!) : "(No title)";

    const dtstart = current["DTSTART"];
    if (!dtstart) {
      result.warnings.push(`Event ${eventIndex} ("${summary}") skipped: missing DTSTART.`);
      return;
    }
    const isAllDay =
      (dtstart.params["VALUE"] ?? "").toUpperCase() === "DATE" ||
      /^\d{8}$/.test(dtstart.value);
    const start = parseICSDate(dtstart.value, isAllDay);
    if (!start) {
      result.warnings.push(`Event ${eventIndex} ("${summary}") skipped: invalid DTSTART.`);
      return;
    }

    let end: Date | null = null;
    const dtend = current["DTEND"];
    if (dtend) {
      end = parseICSDate(
        dtend.value,
        (dtend.params["VALUE"] ?? "").toUpperCase() === "DATE" ||
          /^\d{8}$/.test(dtend.value),
      );
    }
    if (!end) {
      // Default durations per RFC 5545: all-day → 1 day, timed → same instant.
      end = isAllDay ? new Date(start.getTime() + 24 * 60 * 60 * 1000) : new Date(start);
    }
    if (isAllDay) {
      // DTEND is exclusive; Tempo models all-day events with an inclusive end
      // (end at 23:59 of the last day), matching getAllDayEventsForDay.
      end = new Date(end.getTime() - 1);
    }
    if (end < start) end = start;

    const rruleRaw = get("RRULE");
    let rrule: RecurrenceRule | undefined;
    if (rruleRaw) {
      const parsed = parseRRule(rruleRaw);
      if (parsed) {
        rrule = parsed;
      } else {
        result.warnings.push(
          `Event "${summary}": unsupported RRULE "${rruleRaw}" (imported as single event).`,
        );
      }
    }

    const colorRaw = get("COLOR");
    const color = colorRaw ? icsColorToEventColor(colorRaw) : undefined;

    result.events.push({
      title: summary,
      start,
      end,
      isAllDay,
      description: get("DESCRIPTION") ? unescapeText(get("DESCRIPTION")!) : undefined,
      location: get("LOCATION") ? unescapeText(get("LOCATION")!) : undefined,
      rrule,
      color,
      uid: get("UID"),
    });
  };

  for (const line of lines) {
    const { name, params, value } = parseContentLine(line);
    if (name === "BEGIN" && value.toUpperCase() === "VEVENT") {
      inEvent = true;
      current = {};
      continue;
    }
    if (name === "END" && value.toUpperCase() === "VEVENT") {
      if (inEvent) flush();
      inEvent = false;
      continue;
    }
    if (inEvent) {
      // Keep the first occurrence of a property (recurrence-id overrides etc.
      // are out of scope).
      if (!(name in current)) {
        current[name] = { params, value };
      }
      continue;
    }
    // Calendar-level metadata
    if (name === "X-WR-CALNAME") {
      result.calendarName = unescapeText(value);
    } else if (name === "X-WR-CALCOLOR" || name === "COLOR") {
      result.calendarColor = icsColorToEventColor(value);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Generates an ICS string for the given events.
 *
 * When exporting a single calendar, pass its name/color via `calendar`.
 * When exporting multiple calendars, a `calendarResolver` is used to emit
 * per-event `X-TEMPO-CALENDAR` markers so a re-import can route events back.
 */
export function generateICS(
  events: CalendarEvent[],
  options: {
    calendarName?: string;
    calendarColor?: EventColor;
    calendarResolver?: (calendarId: string | undefined) => Calendar | undefined;
  } = {},
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tempo//Tempo Calendar//EN",
    "CALSCALE:GREGORIAN",
  ];

  if (options.calendarName) {
    lines.push(`X-WR-CALNAME:${escapeText(options.calendarName)}`);
  }
  if (options.calendarColor) {
    lines.push(`X-WR-CALCOLOR:${EVENT_COLOR_HEX[options.calendarColor]}`);
  }

  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${event.id}@tempo`);
    lines.push(`DTSTAMP:${formatLocalDateTime(new Date())}`);

    if (event.isAllDay) {
      lines.push(`DTSTART;VALUE=DATE:${toISODate(event.start).replace(/-/g, "")}`);
      // Exclusive end: inclusive last day + 1
      const endExclusive = new Date(event.end);
      endExclusive.setDate(endExclusive.getDate() + 1);
      lines.push(
        `DTEND;VALUE=DATE:${toISODate(endExclusive).replace(/-/g, "")}`,
      );
    } else {
      lines.push(`DTSTART:${formatLocalDateTime(event.start)}`);
      lines.push(`DTEND:${formatLocalDateTime(event.end)}`);
    }

    lines.push(`SUMMARY:${escapeText(event.title || "(No title)")}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeText(event.location)}`);
    }
    if (event.rrule) {
      lines.push(`RRULE:${recurrenceToRRule(event.rrule)}`);
    }
    if (event.color) {
      lines.push(`COLOR:${EVENT_COLOR_HEX[event.color]}`);
    }
    const cal = options.calendarResolver?.(event.calendarId);
    if (cal) {
      lines.push(`X-TEMPO-CALENDAR:${escapeText(cal.name)}`);
    }

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Triggers a browser download of the given ICS content. */
export function downloadICS(filename: string, ics: string): void {
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
