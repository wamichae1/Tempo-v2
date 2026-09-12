// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import { downloadICS, generateICS } from "@/lib/ics";

describe("existing ICS export behavior", () => {
  afterEach(() => vi.restoreAllMocks());

  it("preserves headers, metadata, event fields, recurrence, color, folding, and CRLF", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 10, 9, 30));
    const events: CalendarEvent[] = [
      {
        id: "event-1",
        title: "A title, with punctuation",
        start: new Date(2026, 8, 14, 11, 35),
        end: new Date(2026, 8, 14, 12, 55),
        description: `Line one\n${"long ".repeat(20)}`,
        location: "Room; 101",
        color: "blue",
        calendarId: "school",
        rrule: { freq: "weekly", byWeekDays: [1, 3], count: 4 },
      },
    ];

    const output = generateICS(events, {
      calendarName: "School",
      calendarColor: "blue",
      calendarResolver: () => ({
        id: "school",
        name: "School",
        color: "blue",
        visible: true,
      }),
    });

    expect(output).toContain("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n");
    expect(output).toContain("X-WR-CALNAME:School\r\n");
    expect(output).toContain("UID:event-1@tempo\r\n");
    expect(output).toContain("DTSTART:20260914T113500\r\n");
    expect(output).toContain("SUMMARY:A title\\, with punctuation\r\n");
    expect(output).toContain("LOCATION:Room\\; 101\r\n");
    expect(output).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4\r\n");
    expect(output).toContain("X-TEMPO-CALENDAR:School\r\n");
    expect(output).toMatch(/\r\n [^\r\n]+\r\n/);
    expect(output.endsWith("END:VCALENDAR\r\n")).toBe(true);
    vi.useRealTimers();
  });

  it("keeps all-day DTEND exclusive", () => {
    const output = generateICS([
      {
        id: "all-day",
        title: "Holiday",
        start: new Date(2026, 8, 14),
        end: new Date(2026, 8, 15, 23, 59, 59, 999),
        isAllDay: true,
      },
    ]);
    expect(output).toContain("DTSTART;VALUE=DATE:20260914");
    expect(output).toContain("DTEND;VALUE=DATE:20260916");
  });

  it("keeps the browser download contract", () => {
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadICS("calendar.ics", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");

    expect(createObjectURL).toHaveBeenCalledWith(
      expect.objectContaining({ type: "text/calendar;charset=utf-8" }),
    );
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
});

