import { describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import {
  findFreeTime,
  planEventPush,
  resolvePushAnchor,
} from "@/lib/calendar-scheduling";

const d = (day: number, hour = 0, minute = 0) =>
  new Date(2026, 8, day, hour, minute);

function event(
  id: string,
  start: Date,
  end: Date,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent {
  return {
    id,
    title: id,
    start,
    end,
    calendarId: "cal-a",
    ...extra,
  };
}

describe("findFreeTime", () => {
  it("merges overlapping busy events and ignores free events", () => {
    const windows = findFreeTime(
      [
        event("one", d(7, 10), d(7, 11)),
        event("two", d(7, 10, 30), d(7, 12)),
        event("free", d(7, 12), d(7, 13), { status: "free" }),
      ],
      {
        rangeStart: d(7, 9),
        rangeEnd: d(7, 14),
        durationMinutes: 60,
      },
    );

    expect(windows).toHaveLength(2);
    expect(windows.map((window) => window.availableMinutes)).toEqual([60, 120]);
    expect(windows[0].start).toEqual(d(7, 9));
    expect(windows[1].start).toEqual(d(7, 12));
  });

  it("blocks inclusive all-day spans and applies a daily preferred window", () => {
    const windows = findFreeTime(
      [event("holiday", d(7), d(7), { isAllDay: true })],
      {
        rangeStart: d(7),
        rangeEnd: d(9),
        durationMinutes: 90,
        preferredStartMinutes: 9 * 60,
        preferredEndMinutes: 17 * 60,
      },
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      start: d(8, 9),
      end: d(8, 17),
      availableMinutes: 480,
    });
  });

  it("filters busy calendars and expands recurring events", () => {
    const recurring = event("standup", d(7, 10), d(7, 11), {
      rrule: { freq: "daily", count: 2 },
    });
    const ignored = event("other", d(8, 9), d(8, 10), {
      calendarId: "cal-b",
    });
    const windows = findFreeTime([recurring, ignored], {
      rangeStart: d(8, 9),
      rangeEnd: d(8, 12),
      durationMinutes: 60,
      calendarIds: ["cal-a"],
    });

    expect(windows.map((window) => [window.start, window.end])).toEqual([
      [d(8, 9), d(8, 10)],
      [d(8, 11), d(8, 12)],
    ]);
  });

  it("returns no window when no gap can fit the exact duration", () => {
    expect(
      findFreeTime([event("busy", d(7, 9, 30), d(7, 10, 30))], {
        rangeStart: d(7, 9),
        rangeEnd: d(7, 11),
        durationMinutes: 31,
      }),
    ).toEqual([]);
  });
});

describe("push planning", () => {
  it("selects bounded events, excludes the anchor and other calendars, and skips all-day events", () => {
    const events = [
      event("anchor", d(7, 14), d(7, 15)),
      event("next", d(7, 15), d(7, 16), { description: "keep me" }),
      event("holiday", d(7, 18), d(7, 18), { isAllDay: true }),
      event("other", d(7, 16), d(7, 17), { calendarId: "cal-b" }),
      event("tomorrow", d(8, 9), d(8, 10)),
    ];
    const anchor = resolvePushAnchor(events, "anchor");
    expect(anchor && typeof anchor !== "string").toBe(true);
    const plan = planEventPush(events, {
      anchor: anchor as Exclude<typeof anchor, null | string>,
      offsetMinutes: 30,
      scopeStart: d(7, 15),
      scopeEnd: d(8),
    });

    expect(plan.updates.map((item) => item.id)).toEqual(["next"]);
    expect(plan.updates[0].start).toEqual(d(7, 15, 30));
    expect(plan.updates[0].end).toEqual(d(7, 16, 30));
    expect(plan.updates[0].description).toBe("keep me");
    expect(plan.skippedAllDay.map((item) => item.id)).toEqual(["holiday"]);
  });

  it("deduplicates recurring occurrences and shifts the whole series", () => {
    const events = [
      event("anchor", d(7, 8), d(7, 9)),
      event("daily", d(7, 10), d(7, 11), {
        rrule: { freq: "daily", count: 3 },
      }),
    ];
    const anchor = resolvePushAnchor(events, "anchor");
    const plan = planEventPush(events, {
      anchor: anchor as Exclude<typeof anchor, null | string>,
      offsetMinutes: -30,
      scopeStart: d(7, 9),
      scopeEnd: d(10),
    });

    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0].start).toEqual(d(7, 9, 30));
    expect(plan.wholeSeriesIds).toEqual(["daily"]);
  });

  it("supports an explicit bounded range and opt-in calendars", () => {
    const events = [
      event("anchor", d(7, 9), d(7, 10)),
      event("other-day", d(8, 10), d(8, 11), { calendarId: "cal-b" }),
      event("outside", d(9, 10), d(9, 11), { calendarId: "cal-b" }),
    ];
    const anchor = resolvePushAnchor(events, "anchor");
    const plan = planEventPush(events, {
      anchor: anchor as Exclude<typeof anchor, null | string>,
      offsetMinutes: 45,
      scopeStart: d(8),
      scopeEnd: d(9),
      calendarIds: ["cal-a", "cal-b"],
    });

    expect(plan.updates.map((item) => item.id)).toEqual(["other-day"]);
    expect(plan.updates[0].start).toEqual(d(8, 10, 45));
  });

  it("reports conflicts with unaffected busy events", () => {
    const events = [
      event("anchor", d(7, 9), d(7, 10)),
      event("shifted", d(7, 11), d(7, 12)),
      event("blocker", d(7, 12), d(7, 13), { calendarId: "cal-b" }),
    ];
    const anchor = resolvePushAnchor(events, "anchor");
    const plan = planEventPush(events, {
      anchor: anchor as Exclude<typeof anchor, null | string>,
      offsetMinutes: 30,
      scopeStart: d(7, 10),
      scopeEnd: d(8),
    });

    expect(plan.conflicts).toHaveLength(1);
    expect(new Set([plan.conflicts[0].first.id, plan.conflicts[0].second.id])).toEqual(
      new Set(["shifted", "blocker"]),
    );
  });

  it("requires an exact occurrence id for recurring anchors", () => {
    const recurring = event("daily", d(7, 10), d(7, 11), {
      rrule: { freq: "daily", count: 2 },
    });
    expect(resolvePushAnchor([recurring], "daily")).toBe(
      "recurring-occurrence-required",
    );
    const occurrenceId = `daily@@${d(8, 10).toISOString()}`;
    const resolved = resolvePushAnchor([recurring], occurrenceId);
    expect(resolved && typeof resolved !== "string" && resolved.occurrence.id).toBe(
      occurrenceId,
    );
  });
});
