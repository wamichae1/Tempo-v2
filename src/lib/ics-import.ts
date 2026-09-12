import { addDays, addYears } from "date-fns";

import type {
  CalendarEvent,
  CalendarEventSource,
  ICSTimeMode,
} from "@/components/calendar";
import type { CalendarEventImport } from "@/features/calendar/use-calendar-events";
import { findEventConflictPairs } from "@/lib/conflicts";
import { icsColorToEventColor } from "@/lib/ics";
import {
  describeRecurrence,
  expandEventOccurrences,
  expandEvents,
  toISODate,
  type RecurrenceRule,
} from "@/lib/recurrence";

export const MAX_ICS_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ICS_EVENTS = 5_000;
export const OPEN_RECURRENCE_ANALYSIS_YEARS = 1;
export const OPEN_RECURRENCE_ANALYSIS_OCCURRENCES = 100;

export type ICSIssueSeverity = "info" | "warning" | "unsupported";

export interface ICSImportIssue {
  severity: ICSIssueSeverity;
  message: string;
}

export interface ICSImportCandidate {
  key: string;
  index: number;
  title: string;
  uid?: string;
  event?: CalendarEventImport;
  issues: ICSImportIssue[];
}

export interface ICSImportParseResult {
  fileName: string;
  calendarName?: string;
  calendarColor?: CalendarEvent["color"];
  totalEvents: number;
  candidates: ICSImportCandidate[];
  issues: ICSImportIssue[];
}

export interface ICSDuplicateInfo {
  kind: "uid" | "possible";
  message: string;
  existingTitle?: string;
}

export interface ICSConflictInfo {
  eventId: string;
  title: string;
  start: Date;
  end: Date;
}

export interface ICSImportPreviewItem extends ICSImportCandidate {
  duplicate?: ICSDuplicateInfo;
  conflicts: ICSConflictInfo[];
}

export interface ICSImportAnalysis {
  items: ICSImportPreviewItem[];
  boundedRecurrenceAnalysis: boolean;
}

interface IcalPropertyLike {
  type: string;
  getFirstValue(): unknown;
  getParameter(name: string): unknown;
  getFirstParameter(name: string): string;
  toICALString(): string;
}

interface IcalComponentLike {
  name: string;
  getAllSubcomponents(name?: string): IcalComponentLike[];
  getAllProperties(name?: string): IcalPropertyLike[];
  getFirstProperty(name?: string): IcalPropertyLike | null;
  getFirstPropertyValue(name?: string): unknown;
  getTimeZoneByID(tzid: string): IcalTimezoneLike | null;
}

interface IcalTimezoneLike {
  tzid: string;
}

interface IcalTimeLike {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isDate: boolean;
  zone: IcalTimezoneLike;
  toJSDate(): Date;
  convertToZone(zone: IcalTimezoneLike): IcalTimeLike;
}

interface IcalRecurLike {
  freq: string;
  interval: number;
  count: number | null;
  until: IcalTimeLike | null;
  wkst: number;
  parts: Record<string, unknown>;
}

interface IcalRuntime {
  parse(text: string): unknown[];
  Component: new (jCal: unknown[]) => IcalComponentLike;
  Event: new (component: IcalComponentLike) => {
    startDate: IcalTimeLike;
    endDate: IcalTimeLike;
  };
  Time: {
    fromJSDate(date: Date, useUTC?: boolean): IcalTimeLike;
  };
}

interface ConvertedTime {
  date: Date;
  mode: ICSTimeMode;
  value: string;
  tzid?: string;
  icalTime: IcalTimeLike;
}

const WEEKDAY_INDEX: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

function stringValue(component: IcalComponentLike, name: string): string | undefined {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function propertyValue(property: IcalPropertyLike): string {
  const line = property.toICALString().replace(/\r?\n[ \t]/g, "");
  const colon = line.indexOf(":");
  return colon === -1 ? "" : line.slice(colon + 1).replace(/\r?\n$/, "");
}

function sameWallClock(first: IcalTimeLike, second: IcalTimeLike): boolean {
  return (
    first.year === second.year &&
    first.month === second.month &&
    first.day === second.day &&
    first.hour === second.hour &&
    first.minute === second.minute &&
    first.second === second.second
  );
}

function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function zonedParts(
  formatter: Intl.DateTimeFormat,
  date: Date,
): [number, number, number, number, number, number] {
  const values = new Map(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return [
    values.get("year") ?? 0,
    values.get("month") ?? 0,
    values.get("day") ?? 0,
    values.get("hour") ?? 0,
    values.get("minute") ?? 0,
    values.get("second") ?? 0,
  ];
}

/**
 * Uses the browser's IANA data, when available, to prove a zoned wall-clock
 * value maps to exactly one instant. Returns null for non-IANA/custom TZIDs.
 */
function deterministicZonedInstant(
  time: IcalTimeLike,
  tzid: string,
): Date[] | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: tzid,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return null;
  }

  const target = [
    time.year,
    time.month,
    time.day,
    time.hour,
    time.minute,
    time.second,
  ] as const;
  const targetUtc = Date.UTC(...[
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
  ] as [number, number, number, number, number, number]);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = new Date(targetUtc + hours * 60 * 60 * 1000);
    const parts = zonedParts(formatter, probe);
    const representedUtc = Date.UTC(
      parts[0],
      parts[1] - 1,
      parts[2],
      parts[3],
      parts[4],
      parts[5],
    );
    offsets.add(representedUtc - probe.getTime());
  }

  const matches: Date[] = [];
  for (const offset of offsets) {
    const candidate = new Date(targetUtc - offset);
    if (
      zonedParts(formatter, candidate).every(
        (part, index) => part === target[index],
      )
    ) {
      matches.push(candidate);
    }
  }
  return matches;
}

function convertTime(
  ICAL: IcalRuntime,
  root: IcalComponentLike,
  property: IcalPropertyLike,
  label: string,
): ConvertedTime | ICSImportIssue {
  const value = propertyValue(property);
  const hydrated = property.getFirstValue();
  if (
    !hydrated ||
    typeof hydrated !== "object" ||
    !("toJSDate" in hydrated) ||
    !("isDate" in hydrated)
  ) {
    return {
      severity: "unsupported",
      message: `${label} is not a valid iCalendar date or date-time.`,
    };
  }
  const time = hydrated as IcalTimeLike;
  const tzidValue = property.getParameter("tzid");
  const tzid =
    typeof tzidValue === "string" && tzidValue.trim()
      ? tzidValue.trim()
      : undefined;
  const mode: ICSTimeMode = time.isDate
    ? "date"
    : value.toUpperCase().endsWith("Z")
      ? "utc"
      : tzid
        ? "zoned"
        : "floating";

  if (mode === "zoned" && !root.getTimeZoneByID(tzid!)) {
    return {
      severity: "unsupported",
      message: `${label} uses timezone "${tzid}", but the file does not contain a usable VTIMEZONE definition.`,
    };
  }

  const date = time.toJSDate();
  if (Number.isNaN(date.getTime())) {
    return {
      severity: "unsupported",
      message: `${label} could not be converted to a valid Tempo date.`,
    };
  }

  if (mode === "zoned") {
    const deterministic = deterministicZonedInstant(time, tzid!);
    if (deterministic?.length === 0) {
      return {
        severity: "unsupported",
        message: `${label} is a local time that does not exist in timezone "${tzid}".`,
      };
    }
    if (deterministic && deterministic.length > 1) {
      return {
        severity: "unsupported",
        message: `${label} is ambiguous in timezone "${tzid}" and maps to more than one instant.`,
      };
    }
    if (deterministic?.length === 1 && deterministic[0].getTime() !== date.getTime()) {
      return {
        severity: "unsupported",
        message: `${label} was resolved to a different instant than the browser's timezone data.`,
      };
    }
  }

  let roundTrip: IcalTimeLike;
  if (mode === "date" || mode === "floating") {
    roundTrip = {
      ...time,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
    };
  } else if (mode === "utc") {
    roundTrip = {
      ...time,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  } else {
    const zone = root.getTimeZoneByID(tzid!);
    roundTrip = ICAL.Time.fromJSDate(date, true).convertToZone(zone!);
  }

  if (!sameWallClock(time, roundTrip)) {
    return {
      severity: "unsupported",
      message: `${label} cannot be mapped without changing its original local date or time.`,
    };
  }

  return { date, mode, value, tzid, icalTime: time };
}

function recurrenceRule(
  component: IcalComponentLike,
  start: ConvertedTime,
): { rule?: RecurrenceRule; issue?: ICSImportIssue } {
  const rules = component.getAllProperties("rrule");
  if (rules.length === 0) return {};
  if (rules.length > 1) {
    return {
      issue: {
        severity: "unsupported",
        message: "Multiple RRULE properties cannot be represented by Tempo.",
      },
    };
  }
  if (
    component.getAllProperties("exdate").length > 0 ||
    component.getAllProperties("rdate").length > 0 ||
    component.getAllProperties("recurrence-id").length > 0
  ) {
    return {
      issue: {
        severity: "unsupported",
        message: "Recurrence exceptions, EXDATE, and RDATE are not supported.",
      },
    };
  }

  const recur = rules[0].getFirstValue() as IcalRecurLike;
  const freq = recur.freq?.toLowerCase();
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly") {
    return {
      issue: {
        severity: "unsupported",
        message: `Recurrence frequency "${recur.freq}" is not supported by Tempo.`,
      },
    };
  }
  if (
    start.mode === "utc" ||
    (start.mode === "zoned" && start.tzid !== browserTimeZone())
  ) {
    return {
      issue: {
        severity: "unsupported",
        message:
          "Tempo cannot preserve this recurring event's timezone without changing its wall-clock time.",
      },
    };
  }

  const unsupportedParts = Object.keys(recur.parts ?? {}).filter(
    (part) => !["BYDAY", "BYMONTHDAY"].includes(part),
  );
  if (unsupportedParts.length > 0) {
    return {
      issue: {
        severity: "unsupported",
        message: `Recurrence parts ${unsupportedParts.join(", ")} are not supported by Tempo.`,
      },
    };
  }

  const rule: RecurrenceRule = { freq };
  if (recur.interval > 1) rule.interval = recur.interval;
  if (recur.count != null) {
    if (recur.count < 1 || recur.count > 500) {
      return {
        issue: {
          severity: "unsupported",
          message: "Recurrence COUNT must be between 1 and 500.",
        },
      };
    }
    rule.count = recur.count;
  }
  if (recur.until) {
    const untilDate = recur.until.toJSDate();
    if (Number.isNaN(untilDate.getTime())) {
      return {
        issue: {
          severity: "unsupported",
          message: "The recurrence end date cannot be converted safely.",
        },
      };
    }
    rule.until =
      start.mode === "zoned"
        ? toISODate(untilDate)
        : `${recur.until.year.toString().padStart(4, "0")}-${recur.until.month
            .toString()
            .padStart(2, "0")}-${recur.until.day.toString().padStart(2, "0")}`;
  }
  if (rule.count && rule.until) {
    return {
      issue: {
        severity: "unsupported",
        message: "A recurrence with both COUNT and UNTIL is not supported.",
      },
    };
  }

  const byDay = recur.parts?.BYDAY;
  if (byDay !== undefined) {
    if (
      !Array.isArray(byDay) ||
      byDay.some((token) => typeof token !== "string" || !/^[A-Z]{2}$/.test(token))
    ) {
      return {
        issue: {
          severity: "unsupported",
          message: "Ordinal or malformed BYDAY recurrence values are not supported.",
        },
      };
    }
    const days = byDay
      .map((token) => WEEKDAY_INDEX[token])
      .filter((day): day is number => day !== undefined);
    if (days.length !== byDay.length) {
      return {
        issue: {
          severity: "unsupported",
          message: "The recurrence contains an unknown weekday.",
        },
      };
    }
    if (freq !== "weekly") {
      return {
        issue: {
          severity: "unsupported",
          message: "BYDAY is only supported for weekly Tempo recurrence.",
        },
      };
    }
    if ((rule.interval ?? 1) > 1 && (days.length !== 1 || days[0] !== start.date.getDay())) {
      return {
        issue: {
          severity: "unsupported",
          message: "Multi-day weekly recurrence with an interval cannot be represented exactly.",
        },
      };
    }
    rule.byWeekDays = [...new Set(days)].sort((a, b) => a - b);
  }

  const byMonthDay = recur.parts?.BYMONTHDAY;
  if (byMonthDay !== undefined) {
    if (
      freq !== "monthly" ||
      !Array.isArray(byMonthDay) ||
      byMonthDay.length !== 1 ||
      byMonthDay[0] !== start.date.getDate()
    ) {
      return {
        issue: {
          severity: "unsupported",
          message: "This monthly BYMONTHDAY rule cannot be represented exactly.",
        },
      };
    }
  }

  return { rule };
}

function sourceMetadata(
  uid: string | undefined,
  calendarName: string | undefined,
  start: ConvertedTime,
  end: ConvertedTime | undefined,
): CalendarEventSource {
  return {
    kind: "ics",
    uid,
    calendarName,
    time: {
      startValue: start.value,
      endValue: end?.value,
      startTzid: start.tzid,
      endTzid: end?.tzid,
      startMode: start.mode,
      endMode: end?.mode,
    },
  };
}

function meaningfulFeatureWarnings(component: IcalComponentLike): ICSImportIssue[] {
  const labels: Array<[string, string]> = [
    ["valarm", "reminders"],
    ["attendee", "attendees"],
    ["organizer", "organizer details"],
    ["attach", "attachments"],
    ["conference", "conference details"],
    ["url", "event URL"],
  ];
  const warnings: ICSImportIssue[] = [];
  for (const [property, label] of labels) {
    const present =
      property === "valarm"
        ? component.getAllSubcomponents("valarm").length > 0
        : component.getAllProperties(property).length > 0;
    if (present) {
      warnings.push({
        severity: "warning",
        message: `Tempo will not import ${label}.`,
      });
    }
  }
  return warnings;
}

export async function parseICSImport(
  text: string,
  fileName = "calendar.ics",
): Promise<ICSImportParseResult> {
  const result: ICSImportParseResult = {
    fileName,
    totalEvents: 0,
    candidates: [],
    issues: [],
  };
  if (!text.trim()) {
    result.issues.push({
      severity: "unsupported",
      message: "The selected file is empty.",
    });
    return result;
  }

  let ICAL: IcalRuntime;
  let root: IcalComponentLike;
  try {
    const module = await import("ical.js");
    ICAL = module.default as unknown as IcalRuntime;
    root = new ICAL.Component(ICAL.parse(text));
  } catch (error) {
    result.issues.push({
      severity: "unsupported",
      message:
        error instanceof Error
          ? `The file is not valid iCalendar data: ${error.message}`
          : "The file is not valid iCalendar data.",
    });
    return result;
  }

  if (root.name !== "vcalendar") {
    result.issues.push({
      severity: "unsupported",
      message: "The file does not contain a VCALENDAR component.",
    });
    return result;
  }

  result.calendarName = stringValue(root, "x-wr-calname");
  const calendarColor = stringValue(root, "x-wr-calcolor") ?? stringValue(root, "color");
  result.calendarColor = calendarColor
    ? icsColorToEventColor(calendarColor)
    : undefined;

  const components = root.getAllSubcomponents("vevent");
  result.totalEvents = components.length;
  if (components.length > MAX_ICS_EVENTS) {
    result.issues.push({
      severity: "unsupported",
      message: `This file contains ${components.length} events; Tempo supports at most ${MAX_ICS_EVENTS.toLocaleString()} per import.`,
    });
    return result;
  }
  if (components.length === 0) {
    result.issues.push({
      severity: "unsupported",
      message: "No calendar events were found in this file.",
    });
    return result;
  }

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const title = stringValue(component, "summary")?.trim() || "(No title)";
    const uid = stringValue(component, "uid")?.trim() || undefined;
    const issues = meaningfulFeatureWarnings(component);
    const candidate: ICSImportCandidate = {
      key: `ics-${index + 1}`,
      index,
      title,
      uid,
      issues,
    };
    result.candidates.push(candidate);

    if (!stringValue(component, "summary")?.trim()) {
      issues.push({ severity: "warning", message: "This event has no title." });
    }
    if (stringValue(component, "status")?.toUpperCase() === "CANCELLED") {
      issues.push({
        severity: "unsupported",
        message: "Cancelled ICS events are not imported as active Tempo events.",
      });
      continue;
    }
    if (component.getAllProperties("recurrence-id").length > 0) {
      issues.push({
        severity: "unsupported",
        message: "Recurrence exception instances are not supported.",
      });
      continue;
    }

    const startProperty = component.getFirstProperty("dtstart");
    if (!startProperty) {
      issues.push({ severity: "unsupported", message: "Missing DTSTART." });
      continue;
    }
    const start = convertTime(ICAL, root, startProperty, "DTSTART");
    if ("severity" in start) {
      issues.push(start);
      continue;
    }

    let end: ConvertedTime | undefined;
    const endProperty = component.getFirstProperty("dtend");
    if (endProperty) {
      const convertedEnd = convertTime(ICAL, root, endProperty, "DTEND");
      if ("severity" in convertedEnd) {
        issues.push(convertedEnd);
        continue;
      }
      end = convertedEnd;
    }

    let eventWrapper: { startDate: IcalTimeLike; endDate: IcalTimeLike };
    try {
      eventWrapper = new ICAL.Event(component);
    } catch {
      issues.push({
        severity: "unsupported",
        message: "The event duration or end time is invalid.",
      });
      continue;
    }

    if (!endProperty && !component.getFirstProperty("duration") && !start.icalTime.isDate) {
      issues.push({
        severity: "unsupported",
        message: "Timed events must provide DTEND or DURATION.",
      });
      continue;
    }

    const isAllDay = start.icalTime.isDate;
    const eventEndTime = end?.icalTime ?? eventWrapper.endDate;
    if (eventEndTime.isDate !== isAllDay) {
      issues.push({
        severity: "unsupported",
        message: "DTSTART and DTEND use incompatible DATE and DATE-TIME value types.",
      });
      continue;
    }

    let endDate = end?.date ?? eventEndTime.toJSDate();
    if (isAllDay) {
      if (!endProperty) endDate = addDays(start.date, 1);
      endDate = new Date(endDate.getTime() - 1);
    }
    if (Number.isNaN(endDate.getTime()) || endDate <= start.date) {
      issues.push({
        severity: "unsupported",
        message: "DTEND must be after DTSTART.",
      });
      continue;
    }

    const recurrence = recurrenceRule(component, start);
    if (recurrence.issue) {
      issues.push(recurrence.issue);
      continue;
    }
    if (
      recurrence.rule &&
      end &&
      (start.mode !== end.mode || start.tzid !== end.tzid)
    ) {
      issues.push({
        severity: "unsupported",
        message: "Recurring events with different DTSTART and DTEND timezone semantics are not supported.",
      });
      continue;
    }
    if (start.mode === "floating") {
      issues.push({
        severity: "info",
        message: "This event has floating time and will use this device's local wall clock.",
      });
    }

    const sourceCalendar =
      stringValue(component, "x-tempo-calendar") ?? result.calendarName;
    const eventColor = stringValue(component, "color");
    const transparency = stringValue(component, "transp")?.toUpperCase();
    const visibility = stringValue(component, "class")?.toUpperCase();
    const timezone =
      start.mode === "utc"
        ? "UTC"
        : start.mode === "zoned"
          ? start.tzid
          : undefined;

    candidate.event = {
      title,
      start: start.date,
      end: endDate,
      isAllDay,
      description: stringValue(component, "description"),
      location: stringValue(component, "location"),
      color: eventColor
        ? icsColorToEventColor(eventColor)
        : result.calendarColor,
      timezone,
      rrule: recurrence.rule,
      recurrence: recurrence.rule
        ? describeRecurrence(recurrence.rule, start.date)
        : undefined,
      status: transparency === "TRANSPARENT" ? "free" : "busy",
      visibility:
        visibility === "PUBLIC"
          ? "public"
          : visibility === "PRIVATE" || visibility === "CONFIDENTIAL"
            ? "private"
            : "default",
      source: sourceMetadata(uid, sourceCalendar, start, end),
    };
  }

  return result;
}

function canonicalRule(rule: RecurrenceRule | undefined): string {
  if (!rule) return "";
  return JSON.stringify({
    freq: rule.freq,
    interval: rule.interval ?? 1,
    byWeekDays: rule.byWeekDays ? [...rule.byWeekDays].sort() : [],
    until: rule.until ?? "",
    count: rule.count ?? 0,
  });
}

function fingerprint(event: CalendarEventImport | CalendarEvent): string {
  return [
    event.title.trim().toLocaleLowerCase(),
    event.start.getTime(),
    event.end.getTime(),
    event.isAllDay ? "all-day" : "timed",
    canonicalRule(event.rrule),
  ].join("|");
}

function analysisEnd(event: CalendarEventImport): { end: Date; bounded: boolean } {
  if (!event.rrule) return { end: event.end, bounded: false };
  if (event.rrule.until) {
    return {
      end: addDays(new Date(`${event.rrule.until}T23:59:59.999`), 1),
      bounded: false,
    };
  }
  return {
    end: addYears(event.start, OPEN_RECURRENCE_ANALYSIS_YEARS),
    bounded: true,
  };
}

export function analyzeICSImport(
  parsed: ICSImportParseResult,
  existingEvents: CalendarEvent[],
): ICSImportAnalysis {
  const existingByUid = new Map<string, CalendarEvent>();
  const existingByFingerprint = new Map<string, CalendarEvent>();
  for (const event of existingEvents) {
    const uid = event.source?.kind === "ics" ? event.source.uid : undefined;
    if (uid) existingByUid.set(uid, event);
    existingByUid.set(`${event.id}@tempo`, event);
    existingByFingerprint.set(fingerprint(event), event);
  }

  const seenFileUids = new Map<string, ICSImportCandidate>();
  const seenFileFingerprints = new Map<string, ICSImportCandidate>();
  let boundedRecurrenceAnalysis = false;

  const items = parsed.candidates.map((candidate): ICSImportPreviewItem => {
    const item: ICSImportPreviewItem = { ...candidate, conflicts: [] };
    if (!candidate.event) return item;

    const uidMatch = candidate.uid
      ? existingByUid.get(candidate.uid)
      : undefined;
    const previousUid = candidate.uid
      ? seenFileUids.get(candidate.uid)
      : undefined;
    const eventFingerprint = fingerprint(candidate.event);
    const fallbackMatch = existingByFingerprint.get(eventFingerprint);
    const previousFingerprint = seenFileFingerprints.get(eventFingerprint);

    if (uidMatch) {
      item.duplicate = {
        kind: "uid",
        message: "Already exists in Tempo with the same ICS UID.",
        existingTitle: uidMatch.title,
      };
    } else if (previousUid) {
      item.duplicate = {
        kind: "uid",
        message: `The same ICS UID already appears as "${previousUid.title}" in this file.`,
      };
    } else if (!candidate.uid && fallbackMatch) {
      item.duplicate = {
        kind: "possible",
        message: "Possible duplicate with the same title, date, time, and recurrence.",
        existingTitle: fallbackMatch.title,
      };
    } else if (!candidate.uid && previousFingerprint) {
      item.duplicate = {
        kind: "possible",
        message: `Possible duplicate of "${previousFingerprint.title}" in this file.`,
      };
    }

    if (candidate.uid) seenFileUids.set(candidate.uid, candidate);
    seenFileFingerprints.set(eventFingerprint, candidate);

    const range = analysisEnd(candidate.event);
    boundedRecurrenceAnalysis ||= range.bounded;
    const previewBase: CalendarEvent = {
      ...candidate.event,
      id: `__ics_preview__${candidate.key}`,
    };
    let importedOccurrences = expandEventOccurrences(
      previewBase,
      candidate.event.start,
      range.end,
    );
    if (range.bounded) {
      importedOccurrences = importedOccurrences.slice(
        0,
        OPEN_RECURRENCE_ANALYSIS_OCCURRENCES,
      );
    }
    const existingOccurrences = expandEvents(
      existingEvents,
      candidate.event.start,
      range.end,
    );
    const conflictById = new Map<string, ICSConflictInfo>();
    for (const pair of findEventConflictPairs([
      ...importedOccurrences,
      ...existingOccurrences,
    ])) {
      const firstImported = pair.first.id.startsWith("__ics_preview__");
      const secondImported = pair.second.id.startsWith("__ics_preview__");
      if (firstImported === secondImported) continue;
      const existing = firstImported ? pair.second : pair.first;
      conflictById.set(existing.id, {
        eventId: existing.id,
        title: existing.title,
        start: existing.start,
        end: existing.end,
      });
    }
    item.conflicts = [...conflictById.values()];
    return item;
  });

  return { items, boundedRecurrenceAnalysis };
}
