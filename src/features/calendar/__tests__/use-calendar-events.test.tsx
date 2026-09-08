// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import {
  type CalendarEventsStore,
  useCalendarEvents,
} from "@/features/calendar/use-calendar-events";

const d = (hour: number) => new Date(2026, 8, 7, hour);

describe("CalendarEventsStore.updateEvents", () => {
  let container: HTMLDivElement;
  let root: Root;
  let store: CalendarEventsStore;

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(
      "tempo:calendars",
      JSON.stringify([{ id: "cal", name: "Calendar", color: "blue", visible: true }]),
    );
    localStorage.setItem(
      "tempo:events",
      JSON.stringify([
        { id: "one", title: "One", start: d(9), end: d(10), calendarId: "cal" },
        { id: "two", title: "Two", start: d(10), end: d(11), calendarId: "cal" },
      ]),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const Harness = () => {
      store = useCalendarEvents();
      return <div>{store.events.map((event) => event.start.getHours()).join(",")}</div>;
    };
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("updates, persists, undoes, and redoes a batch as one transaction", async () => {
    const updates: CalendarEvent[] = store.events.map((event) => ({
      ...event,
      start: new Date(event.start.getTime() + 30 * 60_000),
      end: new Date(event.end.getTime() + 30 * 60_000),
    }));

    await act(async () => store.updateEvents(updates));
    expect(store.events.map((event) => event.start.getMinutes())).toEqual([30, 30]);
    expect(store.canUndo).toBe(true);
    const persisted = JSON.parse(localStorage.getItem("tempo:events") ?? "[]");
    expect(persisted).toHaveLength(2);
    expect(persisted.every((event: Record<string, unknown>) => !("baseId" in event))).toBe(
      true,
    );

    await act(async () => store.undo());
    expect(store.events.map((event) => event.start.getHours())).toEqual([9, 10]);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    await act(async () => store.redo());
    expect(store.events.map((event) => event.start.getMinutes())).toEqual([30, 30]);

    await act(async () => store.undo());
    await act(async () =>
      store.addEvent({
        id: "three",
        title: "Three",
        start: d(12),
        end: d(13),
        calendarId: "cal",
      }),
    );
    expect(store.canRedo).toBe(false);
  });

  it("deduplicates occurrence updates by base id and ignores no-op batches", async () => {
    const original = store.events[0];
    await act(async () => store.updateEvents([{ ...original }]));
    expect(store.canUndo).toBe(false);

    await act(async () =>
      store.updateEvents([
        {
          ...original,
          id: "one@@first",
          baseId: "one",
          occurrenceStart: original.start,
          start: d(11),
          end: d(12),
        },
        {
          ...original,
          id: "one@@second",
          baseId: "one",
          occurrenceStart: original.start,
          start: d(12),
          end: d(13),
        },
      ]),
    );
    expect(store.events[0].id).toBe("one");
    expect(store.events[0].start).toEqual(d(12));
    expect(store.canUndo).toBe(true);
  });
});
