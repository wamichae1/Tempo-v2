import { describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import {
  analyzeICSImport,
  parseICSImport,
} from "@/lib/ics-import";

function calendar(...events: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//Tempo//EN",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function event(lines: string[]): string {
  return ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
}

describe("ICS import parsing", () => {
  it("parses multiple timed events, descriptions, locations, and UIDs", async () => {
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:lecture-1",
          "DTSTART:20260914T113500",
          "DTEND:20260914T125500",
          "SUMMARY:COMP 1805 Lecture",
          "DESCRIPTION:Bring notes",
          "LOCATION:Room 101",
        ]),
        event([
          "UID:swim-1",
          "DTSTART:20260914T180000",
          "DTEND:20260914T200000",
          "SUMMARY:Swimming",
        ]),
      ),
      "school.ics",
    );

    expect(parsed.totalEvents).toBe(2);
    expect(parsed.candidates.every((candidate) => candidate.event)).toBe(true);
    expect(parsed.candidates[0].event).toMatchObject({
      title: "COMP 1805 Lecture",
      description: "Bring notes",
      location: "Room 101",
      status: "busy",
      source: { kind: "ics", uid: "lecture-1" },
    });
    expect(parsed.candidates[0].event?.source?.time.startMode).toBe("floating");
  });

  it("normalizes all-day exclusive ends", async () => {
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:holiday",
          "DTSTART;VALUE=DATE:20260914",
          "DTEND;VALUE=DATE:20260916",
          "SUMMARY:Holiday",
        ]),
      ),
    );

    const imported = parsed.candidates[0].event!;
    expect(imported.isAllDay).toBe(true);
    expect(imported.start).toEqual(new Date(2026, 8, 14));
    expect(imported.end).toEqual(new Date(2026, 8, 15, 23, 59, 59, 999));
    expect(imported.source?.time.startMode).toBe("date");
  });

  it("preserves UTC timestamps without treating them as floating", async () => {
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:utc",
          "DTSTART:20260914T150000Z",
          "DTEND:20260914T160000Z",
          "SUMMARY:UTC Event",
        ]),
      ),
    );

    const imported = parsed.candidates[0].event!;
    expect(imported.start.toISOString()).toBe("2026-09-14T15:00:00.000Z");
    expect(imported.timezone).toBe("UTC");
    expect(imported.source?.time).toMatchObject({
      startMode: "utc",
      endMode: "utc",
      startValue: "20260914T150000Z",
    });
  });

  it("uses included VTIMEZONE data and preserves the TZID", async () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Tempo//EN",
      "BEGIN:VTIMEZONE",
      "TZID:America/Toronto",
      "BEGIN:STANDARD",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      event([
        "UID:zoned",
        "DTSTART;TZID=America/Toronto:20260914T110000",
        "DTEND;TZID=America/Toronto:20260914T120000",
        "SUMMARY:Zoned",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const parsed = await parseICSImport(text);
    const imported = parsed.candidates[0].event!;
    expect(imported.start.toISOString()).toBe("2026-09-14T15:00:00.000Z");
    expect(imported.timezone).toBe("America/Toronto");
    expect(imported.source?.time.startTzid).toBe("America/Toronto");
  });

  it("rejects unresolved TZIDs instead of falling back to local time", async () => {
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:unknown-zone",
          "DTSTART;TZID=Custom/School:20260914T110000",
          "DTEND;TZID=Custom/School:20260914T120000",
          "SUMMARY:Unknown zone",
        ]),
      ),
    );

    expect(parsed.candidates[0].event).toBeUndefined();
    expect(parsed.candidates[0].issues[0].message).toContain(
      'timezone "Custom/School"',
    );
  });

  it("rejects zoned wall-clock times that do not round-trip exactly", async () => {
    const text = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//Tempo//EN",
      "BEGIN:VTIMEZONE",
      "TZID:America/Toronto",
      "BEGIN:STANDARD",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "TZOFFSETFROM:-0400",
      "TZOFFSETTO:-0500",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "TZOFFSETFROM:-0500",
      "TZOFFSETTO:-0400",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      event([
        "UID:dst-gap",
        "DTSTART;TZID=America/Toronto:20260308T023000",
        "DTEND;TZID=America/Toronto:20260308T033000",
        "SUMMARY:DST gap",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n");

    const parsed = await parseICSImport(text);
    expect(parsed.candidates[0].event).toBeUndefined();
    expect(parsed.candidates[0].issues[0].message).toContain(
      "does not exist",
    );
  });

  it("preserves supported recurrence and rejects unsupported recurrence features", async () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      (() =>
        ({
          resolvedOptions: () => ({ timeZone: "America/Toronto" }),
        }) as Intl.DateTimeFormat) as typeof Intl.DateTimeFormat,
    );
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:weekly",
          "DTSTART:20260914T110000",
          "DTEND:20260914T120000",
          "SUMMARY:Weekly",
          "RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=8",
        ]),
        event([
          "UID:yearly",
          "DTSTART:20260914T110000",
          "DTEND:20260914T120000",
          "SUMMARY:Yearly",
          "RRULE:FREQ=YEARLY",
        ]),
        event([
          "UID:excluded",
          "DTSTART:20260914T110000",
          "DTEND:20260914T120000",
          "SUMMARY:Excluded",
          "RRULE:FREQ=WEEKLY",
          "EXDATE:20260921T110000",
        ]),
      ),
    );

    expect(parsed.candidates[0].event?.rrule).toEqual({
      freq: "weekly",
      byWeekDays: [1, 3],
      count: 8,
    });
    expect(parsed.candidates[1].event).toBeUndefined();
    expect(parsed.candidates[2].event).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("reports malformed, empty, and zero-event files", async () => {
    const empty = await parseICSImport("");
    expect(empty.issues[0].message).toContain("empty");

    const zero = await parseICSImport(calendar());
    expect(zero.issues[0].message).toContain("No calendar events");

    const malformed = await parseICSImport(
      calendar(event(["UID:missing-start", "SUMMARY:Broken"])),
    );
    expect(malformed.candidates[0].event).toBeUndefined();
    expect(malformed.candidates[0].issues[0].message).toBe("Missing DTSTART.");
  });
});

describe("ICS import analysis", () => {
  it("detects UID and fallback duplicates", async () => {
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:same-uid",
          "DTSTART:20260914T110000",
          "DTEND:20260914T120000",
          "SUMMARY:UID duplicate",
        ]),
        event([
          "DTSTART:20260915T110000",
          "DTEND:20260915T120000",
          "SUMMARY:Fallback duplicate",
        ]),
      ),
    );
    const existing: CalendarEvent[] = [
      {
        id: "existing-uid",
        title: "Already here",
        start: new Date(2026, 8, 14, 11),
        end: new Date(2026, 8, 14, 12),
        source: {
          kind: "ics",
          uid: "same-uid",
          time: { startValue: "", startMode: "floating" },
        },
      },
      {
        id: "fallback",
        title: "Fallback duplicate",
        start: new Date(2026, 8, 15, 11),
        end: new Date(2026, 8, 15, 12),
      },
    ];

    const analysis = analyzeICSImport(parsed, existing);
    expect(analysis.items[0].duplicate?.kind).toBe("uid");
    expect(analysis.items[1].duplicate?.kind).toBe("possible");
  });

  it("detects conflicts with existing Tempo events", async () => {
    const parsed = await parseICSImport(
      calendar(
        event([
          "UID:incoming",
          "DTSTART:20260914T110000",
          "DTEND:20260914T120000",
          "SUMMARY:Incoming",
        ]),
      ),
    );
    const existing: CalendarEvent[] = [
      {
        id: "meeting",
        title: "Meeting",
        start: new Date(2026, 8, 14, 11, 30),
        end: new Date(2026, 8, 14, 12, 30),
      },
    ];

    expect(analyzeICSImport(parsed, existing).items[0].conflicts[0]).toMatchObject({
      eventId: "meeting",
      title: "Meeting",
    });
  });
});
