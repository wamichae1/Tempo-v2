import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CalendarEvent } from "@/components/calendar";
import { occurrenceEditToSeries } from "@/lib/recurrence";
import type { Calendar } from "@/features/calendar/types";
import { createDefaultCalendars, createCalendarId } from "@/features/calendar/types";

/**
 * Centralized calendar store.
 *
 * All state — calendars, events, undo/redo history, clipboard — flows through
 * this single hook. Human UI interactions (drag, resize, detail-panel edits,
 * context-menu actions) and later WebMCP tools both mutate through this API so
 * the model stays consistent and every mutation participates in history.
 *
 * Persistence: calendars and events are serialized to localStorage on every
 * change and restored on load.
 */

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const LS_CALENDARS = "tempo:calendars";
const LS_EVENTS = "tempo:events";

interface SerializedEvent extends Omit<CalendarEvent, "start" | "end" | "occurrenceStart"> {
  start: string;
  end: string;
}

function serializeEvents(events: CalendarEvent[]): string {
  const serializable: SerializedEvent[] = events
    .filter((event) => !event.tutorialOnly)
    .map((e) => ({
      ...e,
      baseId: undefined,
      occurrenceStart: undefined,
      tutorialOnly: undefined,
      start: e.start.toISOString(),
      end: e.end.toISOString(),
    }));
  return JSON.stringify(serializable);
}

function deserializeEvents(json: string): CalendarEvent[] {
  try {
    const parsed = JSON.parse(json) as SerializedEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e) =>
          e &&
          typeof e.id === "string" &&
          e.start &&
          e.end &&
          !e.tutorialOnly,
      )
      .map((e) => ({
        ...e,
        start: new Date(e.start),
        end: new Date(e.end),
      }))
      .filter(
        (e) => !Number.isNaN(e.start.getTime()) && !Number.isNaN(e.end.getTime()),
      );
  } catch {
    return [];
  }
}

function loadInitialState(): { calendars: Calendar[]; events: CalendarEvent[] } {
  try {
    const rawCalendars = localStorage.getItem(LS_CALENDARS);
    const rawEvents = localStorage.getItem(LS_EVENTS);
    // Restore whatever the user already has — never overwrite existing data.
    const calendars = rawCalendars
      ? (JSON.parse(rawCalendars) as Calendar[])
      : [];
    const events = rawEvents ? deserializeEvents(rawEvents) : [];
    if (Array.isArray(calendars) && calendars.length > 0) {
      return { calendars, events };
    }
  } catch {
    // fall through to the empty first-run state
  }

  // First run: start empty — no default calendars, no mock events.
  return { calendars: createDefaultCalendars(), events: [] };
}

// ---------------------------------------------------------------------------
// History (undo/redo)
// ---------------------------------------------------------------------------

interface Snapshot {
  calendars: Calendar[];
  events: CalendarEvent[];
}

const HISTORY_LIMIT = 100;
/**
 * Rapid successive edits with the same coalesce key (e.g. typing in the title
 * field) are merged into a single history entry within this window.
 */
const COALESCE_MS = 1000;

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export interface EventClipboard {
  /** Snapshot of the copied event (id will be regenerated on paste). */
  event: CalendarEvent;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface CalendarEventsStore {
  /** All events (series masters for recurring events), unsorted. */
  events: CalendarEvent[];
  /** All user calendars. */
  calendars: Calendar[];
  /** Insert a new event. */
  addEvent: (event: CalendarEvent) => void;
  /** Replace an existing event. Occurrence edits are mapped back to the series. */
  updateEvent: (event: CalendarEvent) => void;
  /** Remove an event (or whole series) by id or object reference. */
  deleteEvent: (event: CalendarEvent | string) => void;
  /** Look up a single base event by id. */
  getEvent: (id: string) => CalendarEvent | undefined;
  /** Duplicate an event (same time, new id). Returns the new event. */
  duplicateEvent: (event: CalendarEvent) => CalendarEvent;
  /** Copy an event to the internal clipboard. */
  copyEvent: (event: CalendarEvent) => void;
  /**
   * Paste the clipboard event at a target start time, optionally onto another
   * calendar. Returns the created event, or null if the clipboard is empty.
   */
  pasteEvent: (targetStart: Date, calendarId?: string) => CalendarEvent | null;
  /** Current clipboard contents (null when empty). */
  clipboard: EventClipboard | null;
  /** Create a calendar. Returns it. */
  addCalendar: (name: string, color: Calendar["color"]) => Calendar;
  /** Rename / recolor / show-hide a calendar. */
  updateCalendar: (calendar: Calendar) => void;
  /** Delete a calendar and all of its events. */
  deleteCalendar: (calendarId: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Import parsed events into a calendar (single history entry). */
  importEvents: (events: CalendarEvent[], calendarId: string) => void;
}

let idCounter = 0;

/** Generates a unique id for a locally created event. */
export function createEventId(): string {
  idCounter += 1;
  return `local-${Date.now().toString(36)}-${idCounter}`;
}

export function useCalendarEvents(): CalendarEventsStore {
  const [{ calendars, events }, setState] = useState<Snapshot>(loadInitialState);
  const [clipboard, setClipboard] = useState<EventClipboard | null>(null);

  const undoStack = useRef<Snapshot[]>([]);
  const redoStack = useRef<Snapshot[]>([]);
  const lastMutation = useRef<{ key: string; time: number } | null>(null);
  const [, forceRender] = useState(0);

  // Persist on every change.
  useEffect(() => {
    try {
      localStorage.setItem(LS_CALENDARS, JSON.stringify(calendars));
      localStorage.setItem(LS_EVENTS, serializeEvents(events));
    } catch {
      // storage full / unavailable — keep running in memory
    }
  }, [calendars, events]);

  /**
   * Applies a mutation while recording history. Mutations with the same
   * coalesce key within COALESCE_MS extend the current history entry instead
   * of creating a new one.
   */
  const commit = useCallback(
    (mutate: (prev: Snapshot) => Snapshot, coalesceKey?: string) => {
      setState((prev) => {
        const next = mutate(prev);
        if (next === prev) return prev;

        const now = Date.now();
        const last = lastMutation.current;
        const shouldCoalesce =
          coalesceKey !== undefined &&
          last !== null &&
          last.key === coalesceKey &&
          now - last.time < COALESCE_MS;

        if (!shouldCoalesce) {
          undoStack.current.push(prev);
          if (undoStack.current.length > HISTORY_LIMIT) {
            undoStack.current.shift();
          }
          redoStack.current = [];
        }
        lastMutation.current = { key: coalesceKey ?? "", time: now };
        return next;
      });
      // History stack sizes changed without a state change path React tracks.
      forceRender((n) => n + 1);
    },
    [],
  );

  const addEvent = useCallback(
    (event: CalendarEvent) => {
      if (event.tutorialOnly) return;
      commit((prev) => ({ ...prev, events: [...prev.events, event] }));
    },
    [commit],
  );

  const updateEvent = useCallback(
    (event: CalendarEvent) => {
      if (event.tutorialOnly) return;
      commit((prev) => {
        // Map occurrence edits back onto the series master.
        const baseId = event.baseId ?? event.id;
        const base = prev.events.find((e) => e.id === baseId);
        if (!base) return prev;
        const nextEvent = event.baseId
          ? occurrenceEditToSeries(event, base)
          : event;
        return {
          ...prev,
          events: prev.events.map((e) => (e.id === baseId ? nextEvent : e)),
        };
      }, `update:${event.baseId ?? event.id}`);
    },
    [commit],
  );

  const deleteEvent = useCallback(
    (event: CalendarEvent | string) => {
      if (typeof event !== "string" && event.tutorialOnly) return;
      const id =
        typeof event === "string" ? event : (event.baseId ?? event.id);
      commit((prev) => ({
        ...prev,
        events: prev.events.filter((e) => e.id !== id),
      }));
    },
    [commit],
  );

  const duplicateEvent = useCallback(
    (event: CalendarEvent): CalendarEvent => {
      if (event.tutorialOnly) return event;
      const { baseId: _b, occurrenceStart: _o, ...rest } = event;
      const copy: CalendarEvent = {
        ...rest,
        id: createEventId(),
        start: new Date(event.start),
        end: new Date(event.end),
      };
      commit((prev) => ({ ...prev, events: [...prev.events, copy] }));
      return copy;
    },
    [commit],
  );

  const copyEvent = useCallback((event: CalendarEvent) => {
    if (event.tutorialOnly) return;
    const { baseId: _b, occurrenceStart: _o, id: _id, ...rest } = event;
    setClipboard({
      event: {
        ...rest,
        id: "",
        start: new Date(event.start),
        end: new Date(event.end),
      },
    });
  }, []);

  const pasteEvent = useCallback(
    (targetStart: Date, calendarId?: string): CalendarEvent | null => {
      if (!clipboard) return null;
      const duration =
        clipboard.event.end.getTime() - clipboard.event.start.getTime();
      let targetCalendarId = calendarId ?? clipboard.event.calendarId;
      // Validate target calendar still exists
      const exists = calendars.some((c) => c.id === targetCalendarId);
      if (!exists) targetCalendarId = calendars[0]?.id;
      const newEvent: CalendarEvent = {
        ...clipboard.event,
        id: createEventId(),
        start: new Date(targetStart),
        end: new Date(targetStart.getTime() + duration),
        calendarId: targetCalendarId,
      };
      commit((prev) => ({ ...prev, events: [...prev.events, newEvent] }));
      return newEvent;
    },
    [clipboard, calendars, commit],
  );

  const addCalendar = useCallback(
    (name: string, color: Calendar["color"]): Calendar => {
      const calendar: Calendar = {
        id: createCalendarId(),
        name: name.trim() || "Untitled calendar",
        color,
        visible: true,
      };
      commit((prev) => ({ ...prev, calendars: [...prev.calendars, calendar] }));
      return calendar;
    },
    [commit],
  );

  const updateCalendar = useCallback(
    (calendar: Calendar) => {
      commit(
        (prev) => ({
          ...prev,
          calendars: prev.calendars.map((c) =>
            c.id === calendar.id ? calendar : c,
          ),
        }),
        `calendar:${calendar.id}`,
      );
    },
    [commit],
  );

  const deleteCalendar = useCallback(
    (calendarId: string) => {
      commit((prev) => ({
        calendars: prev.calendars.filter((c) => c.id !== calendarId),
        events: prev.events.filter((e) => e.calendarId !== calendarId),
      }));
    },
    [commit],
  );

  const importEvents = useCallback(
    (newEvents: CalendarEvent[], calendarId: string) => {
      const persistentEvents = newEvents.filter((event) => !event.tutorialOnly);
      if (persistentEvents.length === 0) return;
      commit((prev) => ({
        ...prev,
        events: [
          ...prev.events,
          ...persistentEvents.map((e) => ({ ...e, calendarId })),
        ],
      }));
    },
    [commit],
  );

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setState((current) => {
      redoStack.current.push(current);
      return prev;
    });
    lastMutation.current = null;
    forceRender((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    setState((current) => {
      undoStack.current.push(current);
      return next;
    });
    lastMutation.current = null;
    forceRender((n) => n + 1);
  }, []);

  const canUndo = undoStack.current.length > 0;
  const canRedo = redoStack.current.length > 0;

  return useMemo(
    () => ({
      events,
      calendars,
      addEvent,
      updateEvent,
      deleteEvent,
      getEvent: (id: string) => events.find((event) => event.id === id),
      duplicateEvent,
      copyEvent,
      pasteEvent,
      clipboard,
      addCalendar,
      updateCalendar,
      deleteCalendar,
      undo,
      redo,
      canUndo,
      canRedo,
      importEvents,
    }),
    [
      events,
      calendars,
      addEvent,
      updateEvent,
      deleteEvent,
      duplicateEvent,
      copyEvent,
      pasteEvent,
      clipboard,
      addCalendar,
      updateCalendar,
      deleteCalendar,
      undo,
      redo,
      canUndo,
      canRedo,
      importEvents,
    ],
  );
}
