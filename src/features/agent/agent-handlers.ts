import type { CalendarEvent, EventColor } from "@/components/calendar";
import { addDays, startOfDay } from "date-fns";
import type { AgentTool } from "@/features/agent/agent-tool";
import {
  createEventId,
  type CalendarEventsStore,
} from "@/features/calendar/use-calendar-events";
import { EVENT_COLORS } from "@/features/calendar/types";
import { findConflictingEventIds } from "@/lib/conflicts";
import {
  findFreeTime,
  planEventPush,
  resolvePushAnchor,
  type FreeTimeOptions,
  type PushPlan,
} from "@/lib/calendar-scheduling";
import {
  describeRecurrence,
  expandEvents,
  OCCURRENCE_ID_SEPARATOR,
  type RecurrenceRule,
} from "@/lib/recurrence";
import { TOOL_SCHEMAS, serializeCalendar, serializeEvent } from "./agent-tools";

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
  /** Resolve the latest calendar store when a tool executes. */
  getStore: () => CalendarEventsStore;
  /** Ask the user to confirm a destructive action. Resolves true/false. */
  confirm: (request: ConfirmRequest, signal?: AbortSignal) => Promise<boolean>;
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

function parseInteger(value: unknown, minimum: number): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum
    ? value
    : null;
}

function parseLocalTime(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function parseCalendarIds(
  value: unknown,
  store: CalendarEventsStore,
): string[] | null | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    return null;
  }
  const ids = [...new Set(value as string[])];
  return ids.every((id) => store.calendars.some((calendar) => calendar.id === id))
    ? ids
    : null;
}

function parseFreeTimeOptions(
  input: Input,
  store: CalendarEventsStore,
  calendarField: "calendarIds" | "busyCalendarIds",
): FreeTimeOptions | string {
  const rangeStart = parseDate(input.rangeStart);
  const rangeEnd = parseDate(input.rangeEnd);
  if (!rangeStart || !rangeEnd) {
    return "rangeStart and rangeEnd must be ISO date-times";
  }
  if (rangeEnd <= rangeStart) return "rangeEnd must be after rangeStart";
  const durationMinutes = parseInteger(input.durationMinutes, 1);
  if (durationMinutes === null) {
    return "durationMinutes must be a positive integer";
  }
  const calendarIds = parseCalendarIds(input[calendarField], store);
  if (calendarIds === null) return `${calendarField} contains an unknown calendar`;
  const preferredStartMinutes = parseLocalTime(input.preferredStartTime);
  const preferredEndMinutes = parseLocalTime(input.preferredEndTime);
  if (preferredStartMinutes === null || preferredEndMinutes === null) {
    return "preferred times must use HH:mm";
  }
  if ((preferredStartMinutes === undefined) !== (preferredEndMinutes === undefined)) {
    return "preferredStartTime and preferredEndTime must be provided together";
  }
  if (
    preferredStartMinutes !== undefined &&
    preferredEndMinutes !== undefined &&
    preferredEndMinutes <= preferredStartMinutes
  ) {
    return "preferredEndTime must be after preferredStartTime";
  }
  return {
    rangeStart,
    rangeEnd,
    durationMinutes,
    calendarIds,
    preferredStartMinutes,
    preferredEndMinutes,
  };
}

function resolveCalendarId(
  store: CalendarEventsStore,
  value: unknown,
): string | null {
  if (typeof value === "string") {
    return store.calendars.some((calendar) => calendar.id === value)
      ? value
      : null;
  }
  return (
    (store.calendars.find((calendar) => calendar.visible) ?? store.calendars[0])
      ?.id ??
    null
  );
}

function createEvent(
  store: CalendarEventsStore,
  details: {
    title: string;
    start: Date;
    end: Date;
    calendarId: string;
    description?: string;
    location?: string;
    isAllDay?: boolean;
    recurrence?: RecurrenceRule;
  },
): CalendarEvent {
  const event: CalendarEvent = {
    id: createEventId(),
    title: details.title,
    start: details.start,
    end: details.end,
    calendarId: details.calendarId,
    isAllDay: details.isAllDay ?? false,
    description: details.description,
    location: details.location,
    rrule: details.recurrence,
    recurrence: details.recurrence
      ? describeRecurrence(details.recurrence, details.start)
      : undefined,
  };
  store.addEvent(event);
  return event;
}

function serializeWindow(window: { start: Date; end: Date; availableMinutes: number }) {
  return {
    start: window.start.toISOString(),
    end: window.end.toISOString(),
    availableMinutes: window.availableMinutes,
  };
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

export function buildAgentTools(ctx: AgentToolContext): AgentTool[] {
  const { confirm } = ctx;
  // Tools are built once but the store object is recreated every render.
  // Forward property access so execute callbacks always see the latest
  // calendars/events/canUndo, not the render captured at registration time.
  const store = new Proxy({} as CalendarEventsStore, {
    get: (_target, prop) =>
      ctx.getStore()[prop as keyof CalendarEventsStore],
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
      name: "tempo_find_free_time",
      title: "Find free time",
      description:
        "Find maximal conflict-free windows in a date range for a requested duration. Recurring and busy all-day events are considered; events marked free are ignored.",
      inputSchema: TOOL_SCHEMAS.tempo_find_free_time,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: Input) => {
        const parsed = parseFreeTimeOptions(input, store, "calendarIds");
        if (typeof parsed === "string") return err(parsed);
        const windows = findFreeTime(store.events, parsed);
        return ok({
          durationMinutes: parsed.durationMinutes,
          calendarsConsidered:
            parsed.calendarIds ?? store.calendars.map((calendar) => calendar.id),
          windows: windows.map(serializeWindow),
        });
      },
    },
    {
      name: "tempo_push_events",
      title: "Push subsequent events",
      description:
        "Shift timed events after an anchor by a signed minute offset, preserving duration. Defaults to the anchor calendar and same local day. Recurring candidates move as whole series. Requires confirmation and rejects conflicts atomically.",
      inputSchema: TOOL_SCHEMAS.tempo_push_events,
      annotations: { untrustedContentHint: true },
      execute: async (input: Input, options) => {
        if (typeof input.anchorEventId !== "string" || !input.anchorEventId) {
          return err("anchorEventId is required");
        }
        const offsetMinutes = parseInteger(Math.abs(Number(input.offsetMinutes)), 1);
        if (
          offsetMinutes === null ||
          typeof input.offsetMinutes !== "number" ||
          !Number.isSafeInteger(input.offsetMinutes) ||
          input.offsetMinutes === 0
        ) {
          return err("offsetMinutes must be a non-zero integer");
        }
        const signedOffset = input.offsetMinutes;
        const scope = input.scope ?? "same_day";
        if (scope !== "same_day" && scope !== "date_range") {
          return err('scope must be "same_day" or "date_range"');
        }
        const calendarIds = parseCalendarIds(input.calendarIds, store);
        if (calendarIds === null) return err("calendarIds contains an unknown calendar");

        const makePlan = (): PushPlan | string => {
          const anchor = resolvePushAnchor(store.events, input.anchorEventId as string);
          if (anchor === "recurring-occurrence-required") {
            return "a recurring anchor requires an exact occurrence id";
          }
          if (!anchor) return "anchor event not found";

          let scopeStart = anchor.occurrence.end;
          let scopeEnd: Date;
          if (scope === "same_day") {
            scopeEnd = addDays(startOfDay(anchor.occurrence.start), 1);
          } else {
            const rangeStart = parseDate(input.rangeStart);
            const rangeEnd = parseDate(input.rangeEnd);
            if (!rangeStart || !rangeEnd) {
              return "date_range requires ISO rangeStart and rangeEnd";
            }
            if (rangeEnd <= rangeStart) return "rangeEnd must be after rangeStart";
            if (rangeStart > scopeStart) scopeStart = rangeStart;
            scopeEnd = rangeEnd;
          }
          if (scopeEnd <= scopeStart) return "push scope ends before the anchor";
          return planEventPush(store.events, {
            anchor,
            offsetMinutes: signedOffset,
            scopeStart,
            scopeEnd,
            calendarIds,
          });
        };

        const initial = makePlan();
        if (typeof initial === "string") return err(initial);
        const serializeConflicts = (plan: PushPlan) =>
          plan.conflicts.map(({ first, second }) => ({
            shifted: serializeEvent(
              plan.updates.some((event) => event.id === (first.baseId ?? first.id))
                ? first
                : second,
              store.calendars,
            ),
            existing: serializeEvent(
              plan.updates.some((event) => event.id === (first.baseId ?? first.id))
                ? second
                : first,
              store.calendars,
            ),
          }));
        if (initial.conflicts.length > 0) {
          return {
            ok: false as const,
            error: "push would create conflicts",
            conflicts: serializeConflicts(initial),
          };
        }
        if (initial.updates.length === 0) {
          return ok({
            anchor: serializeEvent(initial.anchor, store.calendars),
            offsetMinutes: signedOffset,
            changedCount: 0,
            events: [],
            wholeSeriesIds: [],
            skippedAllDay: initial.skippedAllDay.map((event) =>
              serializeEvent(event, store.calendars),
            ),
            scope: {
              type: scope,
              start: initial.scopeStart.toISOString(),
              end: initial.scopeEnd.toISOString(),
              calendarIds:
                calendarIds ?? [initial.anchor.calendarId].filter(Boolean),
            },
            conflictCheckRange: {
              start: initial.conflictCheckStart.toISOString(),
              end: initial.conflictCheckEnd.toISOString(),
            },
          });
        }

        const approved = await confirm(
          {
            title: "Push calendar events",
            body: `Move ${initial.updates.length} event${initial.updates.length === 1 ? "" : "s"} ${Math.abs(signedOffset)} minutes ${signedOffset > 0 ? "later" : "earlier"}?${initial.wholeSeriesIds.length > 0 ? ` ${initial.wholeSeriesIds.length} recurring series will move in full.` : ""}`,
            confirmLabel: "Push events",
          },
          options.signal,
        );
        if (!approved) return err("user declined the push");

        const revalidated = makePlan();
        if (typeof revalidated === "string") {
          return err("calendar changed while awaiting confirmation; retry the push");
        }
        if (revalidated.fingerprint !== initial.fingerprint) {
          return err("calendar changed while awaiting confirmation; retry the push");
        }
        if (revalidated.conflicts.length > 0) {
          return {
            ok: false as const,
            error: "calendar changed and the push would create conflicts",
            conflicts: serializeConflicts(revalidated),
          };
        }
        store.updateEvents(revalidated.updates);
        return ok({
          anchor: serializeEvent(revalidated.anchor, store.calendars),
          offsetMinutes: signedOffset,
          changedCount: revalidated.updates.length,
          events: revalidated.updates.map((event) =>
            serializeEvent(event, store.calendars),
          ),
          wholeSeriesIds: revalidated.wholeSeriesIds,
          skippedAllDay: revalidated.skippedAllDay.map((event) =>
            serializeEvent(event, store.calendars),
          ),
          scope: {
            type: scope,
            start: revalidated.scopeStart.toISOString(),
            end: revalidated.scopeEnd.toISOString(),
            calendarIds:
              calendarIds ?? [revalidated.anchor.calendarId].filter(Boolean),
          },
          conflictCheckRange: {
            start: revalidated.conflictCheckStart.toISOString(),
            end: revalidated.conflictCheckEnd.toISOString(),
          },
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

        const calendarId = resolveCalendarId(store, input.calendarId);
        if (typeof input.calendarId === "string" && !calendarId) {
          return err(`unknown calendarId "${input.calendarId}"`);
        }
        if (!calendarId) return err("no calendar exists to hold the event");

        const recurrence = parseRecurrence(input.recurrence);
        if (recurrence === null) return err("invalid recurrence rule");

        const event = createEvent(store, {
          title: input.title.trim(),
          start,
          end,
          calendarId,
          isAllDay: input.isAllDay === true,
          description:
            typeof input.description === "string" ? input.description : undefined,
          location:
            typeof input.location === "string" ? input.location : undefined,
          recurrence: recurrence ?? undefined,
        });
        return ok({ event: serializeEvent(event, store.calendars) });
      },
    },
    {
      name: "tempo_schedule_event",
      title: "Schedule event in free time",
      description:
        "Find the earliest conflict-free slot matching a duration and optional local-time window, then create one non-recurring timed event without moving existing events.",
      inputSchema: TOOL_SCHEMAS.tempo_schedule_event,
      annotations: { untrustedContentHint: true },
      execute: async (input: Input) => {
        if (typeof input.title !== "string" || !input.title.trim()) {
          return err("title is required");
        }
        const parsed = parseFreeTimeOptions(input, store, "busyCalendarIds");
        if (typeof parsed === "string") return err(parsed);
        const calendarId = resolveCalendarId(store, input.calendarId);
        if (typeof input.calendarId === "string" && !calendarId) {
          return err(`unknown calendarId "${String(input.calendarId)}"`);
        }
        if (!calendarId) return err("no calendar exists to hold the event");
        const window = findFreeTime(store.events, parsed)[0];
        if (!window) {
          return {
            ok: false as const,
            error: "no suitable free time found",
            durationMinutes: parsed.durationMinutes,
            range: {
              start: parsed.rangeStart.toISOString(),
              end: parsed.rangeEnd.toISOString(),
            },
          };
        }
        const start = window.start;
        const end = new Date(start.getTime() + parsed.durationMinutes * 60_000);
        const event = createEvent(store, {
          title: input.title.trim(),
          start,
          end,
          calendarId,
          description:
            typeof input.description === "string" ? input.description : undefined,
          location:
            typeof input.location === "string" ? input.location : undefined,
        });
        return ok({
          selectedSlot: {
            start: start.toISOString(),
            end: end.toISOString(),
          },
          event: serializeEvent(event, store.calendars),
        });
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
      execute: async (input: Input, options) => {
        const base = findBaseEvent(store, input.eventId);
        if (!base) return err("event not found");
        const approved = await confirm(
          {
            title: "Delete event",
            body: base.rrule
              ? `The agent wants to delete "${base.title}" and its entire recurring series.`
              : `The agent wants to delete "${base.title}".`,
            confirmLabel: "Delete",
          },
          options.signal,
        );
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
      execute: async (input: Input, options) => {
        const calendar = store.calendars.find((c) => c.id === input.calendarId);
        if (!calendar) return err("calendar not found");
        if (store.calendars.length <= 1) {
          return err("cannot delete the last remaining calendar");
        }
        const count = store.events.filter(
          (e) => e.calendarId === calendar.id,
        ).length;
        const approved = await confirm(
          {
            title: "Delete calendar",
            body: `The agent wants to delete the calendar "${calendar.name}" and its ${count} event${count === 1 ? "" : "s"}.`,
            confirmLabel: "Delete calendar",
          },
          options.signal,
        );
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
