import type { CalendarEvent, EventColor } from "@/components/calendar";
import {
  createEventId,
  type CalendarEventsStore,
} from "@/features/calendar/use-calendar-events";
import { EVENT_COLORS } from "@/features/calendar/types";
import { findConflictingEventIds } from "@/lib/conflicts";
import {
  describeRecurrence,
  expandEvents,
  OCCURRENCE_ID_SEPARATOR,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { TOOL_SCHEMAS, serializeCalendar, serializeEvent } from "./agent-tools";
import type { WebMcpTool } from "./webmcp";

/**
 * Execute implementations for Tempo's WebMCP tools.
 *
 * Every mutation goes through the centralized CalendarEventsStore so agent
 * edits behave exactly like human edits: they record undo history, trigger
 * localStorage persistence, and re-render the views.
 *
 * Handlers validate their own inputs (agents can send anything) and return
 * `{ ok: false, error }` instead of throwing for expected failures.
 */

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
}

export interface AgentToolContext {
  store: CalendarEventsStore;
  /** Ask the user to confirm a destructive action. Resolves true/false. */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
}

type Input = Record<string, unknown>;

const ok = (data: Record<string, unknown>) => ({ ok: true as const, ...data });
const err = (error: string) => ({ ok: false as const, error });

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseRecurrence(value: unknown): RecurrenceRule | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (v.freq !== "daily" && v.freq !== "weekly" && v.freq !== "monthly") {
    return null;
  }
  const rule: RecurrenceRule = { freq: v.freq };
  if (typeof v.interval === "number" && v.interval >= 1) {
    rule.interval = Math.floor(v.interval);
  }
  if (Array.isArray(v.byWeekDays)) {
    const days = v.byWeekDays.filter(
      (d): d is number => typeof d === "number" && d >= 0 && d <= 6,
    );
    if (days.length > 0) rule.byWeekDays = days;
  }
  if (typeof v.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.until)) {
    rule.until = v.until;
  }
  if (typeof v.count === "number" && v.count >= 1) {
    rule.count = Math.floor(v.count);
  }
  return rule;
}

function parseColor(value: unknown): EventColor | null | undefined {
  if (value === undefined) return undefined;
  return EVENT_COLORS.includes(value as EventColor)
    ? (value as EventColor)
    : null;
}

/** Resolve a base event from an id that may be an expanded occurrence id. */
function findBaseEvent(
  store: CalendarEventsStore,
  eventId: unknown,
): CalendarEvent | null {
  if (typeof eventId !== "string" || eventId.length === 0) return null;
  const baseId = eventId.split(OCCURRENCE_ID_SEPARATOR)[0];
  return store.getEvent(baseId) ?? null;
}

export function buildAgentTools(ctx: AgentToolContext): WebMcpTool[] {
  const { confirm } = ctx;
  // Tools are built once but the store object is recreated every render.
  // Forward property access so execute callbacks always see the latest
  // calendars/events/canUndo, not the render captured at registration time.
  const store = new Proxy({} as CalendarEventsStore, {
    get: (_target, prop) => ctx.store[prop as keyof CalendarEventsStore],
  });

  return [
    {
      name: "tempo_list_calendars",
      title: "List calendars",
      description:
        "List the user's calendars in Tempo with id, name, color, visibility, and event count.",
      inputSchema: TOOL_SCHEMAS.tempo_list_calendars,
      annotations: { readOnlyHint: true },
      execute: async () => {
        const counts = new Map<string, number>();
        for (const e of store.events) {
          const id = e.calendarId ?? "";
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        return ok({
          calendars: store.calendars.map((c) =>
            serializeCalendar(c, counts.get(c.id) ?? 0),
          ),
        });
      },
    },
    {
      name: "tempo_list_events",
      title: "List events in range",
      description:
        "List events between two dates (recurring events are expanded into occurrences). Optionally filter by calendar or search text.",
      inputSchema: TOOL_SCHEMAS.tempo_list_events,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: Input) => {
        const start = parseDate(input.start);
        const end = parseDate(input.end);
        if (!start || !end) return err("start and end must be ISO date-times");
        if (end < start) return err("end must be after start");
        let events = expandEvents(store.events, start, end);
        if (typeof input.calendarId === "string") {
          events = events.filter((e) => e.calendarId === input.calendarId);
        }
        if (typeof input.query === "string" && input.query.trim()) {
          const q = input.query.trim().toLowerCase();
          events = events.filter((e) =>
            [e.title, e.description, e.location].some((f) =>
              f?.toLowerCase().includes(q),
            ),
          );
        }
        events.sort((a, b) => a.start.getTime() - b.start.getTime());
        return ok({
          events: events.map((e) => serializeEvent(e, store.calendars)),
        });
      },
    },
    {
      name: "tempo_get_event",
      title: "Get event",
      description: "Get full details for a single event by id.",
      inputSchema: TOOL_SCHEMAS.tempo_get_event,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: Input) => {
        const event = findBaseEvent(store, input.eventId);
        if (!event) return err("event not found");
        return ok({ event: serializeEvent(event, store.calendars) });
      },
    },
    {
      name: "tempo_find_conflicts",
      title: "Find scheduling conflicts",
      description:
        "Find overlapping timed events between two dates. All-day events are ignored.",
      inputSchema: TOOL_SCHEMAS.tempo_find_conflicts,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: Input) => {
        const start = parseDate(input.start);
        const end = parseDate(input.end);
        if (!start || !end) return err("start and end must be ISO date-times");
        let events = expandEvents(store.events, start, end);
        if (typeof input.calendarId === "string") {
          events = events.filter((e) => e.calendarId === input.calendarId);
        }
        const ids = findConflictingEventIds(events);
        const conflicting = events.filter((e) => ids.has(e.id));
        return ok({
          conflicts: conflicting.map((e) => serializeEvent(e, store.calendars)),
        });
      },
    },
    {
      name: "tempo_create_event",
      title: "Create event",
      description:
        "Create a new calendar event, optionally recurring. Times are ISO date-times in the user's local timezone.",
      inputSchema: TOOL_SCHEMAS.tempo_create_event,
      execute: async (input: Input) => {
        if (typeof input.title !== "string" || !input.title.trim()) {
          return err("title is required");
        }
        const start = parseDate(input.start);
        const end = parseDate(input.end);
        if (!start || !end) return err("start and end must be ISO date-times");
        if (end <= start) return err("end must be after start");

        let calendarId =
          typeof input.calendarId === "string" ? input.calendarId : undefined;
        if (calendarId && !store.calendars.some((c) => c.id === calendarId)) {
          return err(`unknown calendarId "${calendarId}"`);
        }
        calendarId ??=
          (store.calendars.find((c) => c.visible) ?? store.calendars[0])?.id;
        if (!calendarId) return err("no calendar exists to hold the event");

        const recurrence = parseRecurrence(input.recurrence);
        if (recurrence === null) return err("invalid recurrence rule");

        const event: CalendarEvent = {
          id: createEventId(),
          title: input.title.trim(),
          start,
          end,
          calendarId,
          isAllDay: input.isAllDay === true,
          description:
            typeof input.description === "string" ? input.description : undefined,
          location:
            typeof input.location === "string" ? input.location : undefined,
          rrule: recurrence ?? undefined,
          recurrence: recurrence
            ? describeRecurrence(recurrence, start)
            : undefined,
        };
        store.addEvent(event);
        return ok({ event: serializeEvent(event, store.calendars) });
      },
    },
    {
      name: "tempo_update_event",
      title: "Update event",
      description:
        "Update fields of an existing event. For recurring events the whole series is updated (per-occurrence edits are not supported).",
      inputSchema: TOOL_SCHEMAS.tempo_update_event,
      execute: async (input: Input) => {
        const base = findBaseEvent(store, input.eventId);
        if (!base) return err("event not found");
        const patch =
          typeof input.patch === "object" && input.patch !== null
            ? (input.patch as Input)
            : null;
        if (!patch) return err("patch object is required");

        const next: CalendarEvent = {
          ...base,
          start: new Date(base.start),
          end: new Date(base.end),
        };
        if (patch.title !== undefined) {
          if (typeof patch.title !== "string" || !patch.title.trim()) {
            return err("title must be a non-empty string");
          }
          next.title = patch.title.trim();
        }
        if (patch.start !== undefined) {
          const d = parseDate(patch.start);
          if (!d) return err("patch.start must be an ISO date-time");
          next.start = d;
        }
        if (patch.end !== undefined) {
          const d = parseDate(patch.end);
          if (!d) return err("patch.end must be an ISO date-time");
          next.end = d;
        }
        if (next.end <= next.start) return err("end must be after start");
        if (patch.description !== undefined) {
          next.description =
            typeof patch.description === "string"
              ? patch.description
              : undefined;
        }
        if (patch.location !== undefined) {
          next.location =
            typeof patch.location === "string" ? patch.location : undefined;
        }
        if (patch.isAllDay !== undefined) {
          next.isAllDay = patch.isAllDay === true;
        }
        if (patch.calendarId !== undefined) {
          if (
            typeof patch.calendarId !== "string" ||
            !store.calendars.some((c) => c.id === patch.calendarId)
          ) {
            return err(`unknown calendarId "${String(patch.calendarId)}"`);
          }
          next.calendarId = patch.calendarId;
        }
        if (patch.recurrence !== undefined) {
          const rule = parseRecurrence(patch.recurrence);
          if (!rule) return err("invalid recurrence rule");
          next.rrule = rule;
          next.recurrence = describeRecurrence(rule, next.start);
        }
        store.updateEvent(next);
        return ok({ event: serializeEvent(next, store.calendars) });
      },
    },
    {
      name: "tempo_move_event",
      title: "Move event",
      description: "Move an event to a new start/end time.",
      inputSchema: TOOL_SCHEMAS.tempo_move_event,
      execute: async (input: Input) => {
        const base = findBaseEvent(store, input.eventId);
        if (!base) return err("event not found");
        const start = parseDate(input.start);
        const end = parseDate(input.end);
        if (!start || !end) return err("start and end must be ISO date-times");
        if (end <= start) return err("end must be after start");
        const next: CalendarEvent = { ...base, start, end };
        store.updateEvent(next);
        return ok({ event: serializeEvent(next, store.calendars) });
      },
    },
    {
      name: "tempo_duplicate_event",
      title: "Duplicate event",
      description:
        "Duplicate an event, optionally at a new start time (duration preserved).",
      inputSchema: TOOL_SCHEMAS.tempo_duplicate_event,
      execute: async (input: Input) => {
        const base = findBaseEvent(store, input.eventId);
        if (!base) return err("event not found");
        const copy = store.duplicateEvent(base);
        if (input.newStart !== undefined) {
          const newStart = parseDate(input.newStart);
          if (!newStart) return err("newStart must be an ISO date-time");
          const duration = base.end.getTime() - base.start.getTime();
          const moved: CalendarEvent = {
            ...copy,
            start: newStart,
            end: new Date(newStart.getTime() + duration),
          };
          store.updateEvent(moved);
          return ok({ event: serializeEvent(moved, store.calendars) });
        }
        return ok({ event: serializeEvent(copy, store.calendars) });
      },
    },
    {
      name: "tempo_delete_event",
      title: "Delete event",
      description:
        "Delete an event. For recurring events the entire series is deleted. Requires user confirmation.",
      inputSchema: TOOL_SCHEMAS.tempo_delete_event,
      execute: async (input: Input) => {
        const base = findBaseEvent(store, input.eventId);
        if (!base) return err("event not found");
        const approved = await confirm({
          title: "Delete event",
          body: base.rrule
            ? `The agent wants to delete "${base.title}" and its entire recurring series.`
            : `The agent wants to delete "${base.title}".`,
          confirmLabel: "Delete",
        });
        if (!approved) return err("user declined the deletion");
        store.deleteEvent(base.id);
        return ok({ deleted: base.id });
      },
    },
    {
      name: "tempo_create_calendar",
      title: "Create calendar",
      description: "Create a new calendar with a name and optional color.",
      inputSchema: TOOL_SCHEMAS.tempo_create_calendar,
      execute: async (input: Input) => {
        if (typeof input.name !== "string" || !input.name.trim()) {
          return err("name is required");
        }
        const color = parseColor(input.color);
        if (color === null) return err("invalid color");
        const calendar = store.addCalendar(
          input.name.trim(),
          color ?? EVENT_COLORS[store.calendars.length % EVENT_COLORS.length],
        );
        return ok({ calendar: serializeCalendar(calendar, 0) });
      },
    },
    {
      name: "tempo_update_calendar",
      title: "Update calendar",
      description: "Rename, recolor, or show/hide a calendar.",
      inputSchema: TOOL_SCHEMAS.tempo_update_calendar,
      execute: async (input: Input) => {
        const calendar = store.calendars.find((c) => c.id === input.calendarId);
        if (!calendar) return err("calendar not found");
        const next = { ...calendar };
        if (input.name !== undefined) {
          if (typeof input.name !== "string" || !input.name.trim()) {
            return err("name must be a non-empty string");
          }
          next.name = input.name.trim();
        }
        if (input.color !== undefined) {
          const color = parseColor(input.color);
          if (!color) return err("invalid color");
          next.color = color;
        }
        if (input.visible !== undefined) {
          next.visible = input.visible === true;
        }
        store.updateCalendar(next);
        const count = store.events.filter(
          (e) => e.calendarId === next.id,
        ).length;
        return ok({ calendar: serializeCalendar(next, count) });
      },
    },
    {
      name: "tempo_delete_calendar",
      title: "Delete calendar",
      description:
        "Delete a calendar and all of its events. Requires user confirmation.",
      inputSchema: TOOL_SCHEMAS.tempo_delete_calendar,
      execute: async (input: Input) => {
        const calendar = store.calendars.find((c) => c.id === input.calendarId);
        if (!calendar) return err("calendar not found");
        if (store.calendars.length <= 1) {
          return err("cannot delete the last remaining calendar");
        }
        const count = store.events.filter(
          (e) => e.calendarId === calendar.id,
        ).length;
        const approved = await confirm({
          title: "Delete calendar",
          body: `The agent wants to delete the calendar "${calendar.name}" and its ${count} event${count === 1 ? "" : "s"}.`,
          confirmLabel: "Delete calendar",
        });
        if (!approved) return err("user declined the deletion");
        store.deleteCalendar(calendar.id);
        return ok({ deleted: calendar.id, deletedEvents: count });
      },
    },
    {
      name: "tempo_undo",
      title: "Undo",
      description: "Undo the most recent calendar change.",
      inputSchema: TOOL_SCHEMAS.tempo_undo,
      execute: async () => {
        if (!store.canUndo) return err("nothing to undo");
        store.undo();
        return ok({ canUndo: store.canUndo, canRedo: store.canRedo });
      },
    },
    {
      name: "tempo_redo",
      title: "Redo",
      description: "Redo the most recently undone calendar change.",
      inputSchema: TOOL_SCHEMAS.tempo_redo,
      execute: async () => {
        if (!store.canRedo) return err("nothing to redo");
        store.redo();
        return ok({ canUndo: store.canUndo, canRedo: store.canRedo });
      },
    },
  ];
}
