import { describe, expect, it, vi } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import { buildAgentTools } from "@/features/agent/agent-handlers";
import { CONFIRMATION_PROTECTED } from "@/features/agent/agent-tool-metadata";
import type { CalendarEventsStore } from "@/features/calendar/use-calendar-events";

const d = (hour: number, minute = 0) => new Date(2026, 8, 7, hour, minute);

function makeStore(events: CalendarEvent[] = []): CalendarEventsStore {
  const store = {
    events: [...events],
    calendars: [{ id: "cal", name: "Calendar", color: "blue", visible: true }],
    addEvent: vi.fn((event: CalendarEvent) => store.events.push(event)),
    updateEvent: vi.fn(),
    updateEvents: vi.fn((updates: CalendarEvent[]) => {
      const byId = new Map(updates.map((event) => [event.id, event]));
      store.events = store.events.map((event) => byId.get(event.id) ?? event);
    }),
    deleteEvent: vi.fn(),
    getEvent: (id: string) => store.events.find((event) => event.id === id),
    duplicateEvent: vi.fn(),
    copyEvent: vi.fn(),
    pasteEvent: vi.fn(),
    clipboard: null,
    addCalendar: vi.fn(),
    updateCalendar: vi.fn(),
    deleteCalendar: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    importEvents: vi.fn(),
  } as unknown as CalendarEventsStore;
  return store;
}

function event(id: string, start: Date, end: Date): CalendarEvent {
  return { id, title: id, start, end, calendarId: "cal" };
}

function toolsFor(store: CalendarEventsStore, confirm = vi.fn(async () => true)) {
  return {
    tools: buildAgentTools({ getStore: () => store, confirm }),
    confirm,
  };
}

function tool(
  tools: ReturnType<typeof buildAgentTools>,
  name: string,
) {
  const found = tools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

const signal = new AbortController().signal;

describe("high-level agent tools", () => {
  it("registers all three tools with the expected annotations and metadata", () => {
    const { tools } = toolsFor(makeStore());
    expect(tools).toHaveLength(17);
    expect(tool(tools, "tempo_find_free_time").annotations?.readOnlyHint).toBe(true);
    expect(tool(tools, "tempo_push_events").annotations?.readOnlyHint).not.toBe(true);
    expect(tool(tools, "tempo_schedule_event").annotations?.readOnlyHint).not.toBe(
      true,
    );
    expect(CONFIRMATION_PROTECTED.has("tempo_push_events")).toBe(true);
    expect(tool(tools, "tempo_push_events").inputSchema).toMatchObject({
      required: ["anchorEventId", "offsetMinutes"],
    });
  });

  it("finds free windows without calling any store mutation", async () => {
    const store = makeStore([event("busy", d(10), d(11))]);
    const { tools } = toolsFor(store);
    const result = (await tool(tools, "tempo_find_free_time").execute(
      {
        rangeStart: d(9).toISOString(),
        rangeEnd: d(13).toISOString(),
        durationMinutes: 60,
      },
      { signal },
    )) as { ok: boolean; windows: Array<{ availableMinutes: number }> };

    expect(result.ok).toBe(true);
    expect(result.windows.map((window) => window.availableMinutes)).toEqual([60, 120]);
    expect(store.addEvent).not.toHaveBeenCalled();
    expect(store.updateEvents).not.toHaveBeenCalled();
  });

  it("schedules the earliest fitting slot through addEvent", async () => {
    const store = makeStore([event("busy", d(9), d(10))]);
    const { tools } = toolsFor(store);
    const result = (await tool(tools, "tempo_schedule_event").execute(
      {
        title: "Study",
        rangeStart: d(9).toISOString(),
        rangeEnd: d(13).toISOString(),
        durationMinutes: 90,
      },
      { signal },
    )) as { ok: boolean; event: { title: string; start: string; end: string } };

    expect(result.ok).toBe(true);
    expect(result.event.title).toBe("Study");
    expect(new Date(result.event.start)).toEqual(d(10));
    expect(new Date(result.event.end)).toEqual(d(11, 30));
    expect(store.addEvent).toHaveBeenCalledOnce();
  });

  it("does not mutate when no scheduling slot fits", async () => {
    const store = makeStore([event("busy", d(9), d(13))]);
    const { tools } = toolsFor(store);
    const result = (await tool(tools, "tempo_schedule_event").execute(
      {
        title: "Study",
        rangeStart: d(9).toISOString(),
        rangeEnd: d(13).toISOString(),
        durationMinutes: 60,
      },
      { signal },
    )) as { ok: boolean; error: string };

    expect(result).toMatchObject({ ok: false, error: "no suitable free time found" });
    expect(store.addEvent).not.toHaveBeenCalled();
  });

  it("confirms and commits a push with one batch call", async () => {
    const store = makeStore([
      event("anchor", d(9), d(10)),
      event("one", d(10), d(11)),
      event("two", d(11), d(12)),
    ]);
    const { tools, confirm } = toolsFor(store);
    const result = (await tool(tools, "tempo_push_events").execute(
      { anchorEventId: "anchor", offsetMinutes: 30 },
      { signal },
    )) as { ok: boolean; changedCount: number };

    expect(result).toMatchObject({ ok: true, changedCount: 2 });
    expect(confirm).toHaveBeenCalledOnce();
    expect(store.updateEvents).toHaveBeenCalledOnce();
    expect(store.events.slice(1).map((item) => item.start.getMinutes())).toEqual([
      30, 30,
    ]);
  });

  it("keeps a declined push unchanged", async () => {
    const store = makeStore([
      event("anchor", d(9), d(10)),
      event("next", d(10), d(11)),
    ]);
    const { tools } = toolsFor(store, vi.fn(async () => false));
    const result = (await tool(tools, "tempo_push_events").execute(
      { anchorEventId: "anchor", offsetMinutes: 30 },
      { signal },
    )) as { ok: boolean; error: string };

    expect(result.ok).toBe(false);
    expect(store.updateEvents).not.toHaveBeenCalled();
  });

  it("rejects a stale push preview after confirmation", async () => {
    const store = makeStore([
      event("anchor", d(9), d(10)),
      event("next", d(10), d(11)),
    ]);
    const confirm = vi.fn(async () => {
      store.events[1] = event("next", d(10, 15), d(11, 15));
      return true;
    });
    const { tools } = toolsFor(store, confirm);
    const result = await tool(tools, "tempo_push_events").execute(
      { anchorEventId: "anchor", offsetMinutes: 30 },
      { signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: "calendar changed while awaiting confirmation; retry the push",
    });
    expect(store.updateEvents).not.toHaveBeenCalled();
  });

  it("rejects a conflicting push atomically before confirmation", async () => {
    const store = makeStore([
      event("anchor", d(9), d(10)),
      event("next", d(10), d(11)),
      { ...event("blocker", d(11), d(12)), calendarId: "other" },
    ]);
    store.calendars.push({ id: "other", name: "Other", color: "green", visible: true });
    const { tools, confirm } = toolsFor(store);
    const result = (await tool(tools, "tempo_push_events").execute(
      { anchorEventId: "anchor", offsetMinutes: 30 },
      { signal },
    )) as { ok: boolean; error: string; conflicts: unknown[] };

    expect(result).toMatchObject({ ok: false, error: "push would create conflicts" });
    expect(result.conflicts).toHaveLength(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(store.updateEvents).not.toHaveBeenCalled();
  });

  it("validates paired preferred times and recurring anchor ids", async () => {
    const recurring = {
      ...event("daily", d(9), d(10)),
      rrule: { freq: "daily" as const, count: 2 },
    };
    const store = makeStore([recurring]);
    const { tools } = toolsFor(store);
    const freeResult = await tool(tools, "tempo_find_free_time").execute(
      {
        rangeStart: d(9).toISOString(),
        rangeEnd: d(13).toISOString(),
        durationMinutes: 30,
        preferredStartTime: "09:00",
      },
      { signal },
    );
    expect(freeResult).toMatchObject({ ok: false });
    const pushResult = await tool(tools, "tempo_push_events").execute(
      { anchorEventId: "daily", offsetMinutes: 30 },
      { signal },
    );
    expect(pushResult).toMatchObject({
      ok: false,
      error: "a recurring anchor requires an exact occurrence id",
    });
  });
});
