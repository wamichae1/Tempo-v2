import type { CalendarEvent } from "@/components/calendar";
import type { Calendar } from "@/features/calendar/types";
import type { RecurrenceRule } from "@/lib/recurrence";

/**
 * JSON Schemas and shared serialization helpers for Tempo's WebMCP tools.
 * Kept separate from the handlers so schemas stay easy to audit (the spec
 * flags tool descriptions/schemas as a prompt-injection surface).
 */

const ISO_DATE_TIME = {
  type: "string",
  format: "date-time",
  description: "ISO 8601 date-time, e.g. 2026-09-02T14:00:00",
} as const;

const LOCAL_TIME = {
  type: "string",
  pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
  description: "Local wall-clock time in HH:mm format.",
} as const;

const CALENDAR_IDS = {
  type: "array",
  minItems: 1,
  uniqueItems: true,
  items: { type: "string" },
  description: "Calendar ids to include; omission uses the documented default.",
} as const;

const RECURRENCE_SCHEMA = {
  type: "object",
  description: "RFC 5545-style recurrence rule (subset).",
  properties: {
    freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
    interval: { type: "integer", minimum: 1 },
    byWeekDays: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 6 },
      description: "Weekdays (0=Sunday..6=Saturday), weekly rules only.",
    },
    until: { type: "string", description: "Inclusive end date, yyyy-mm-dd." },
    count: { type: "integer", minimum: 1 },
  },
  required: ["freq"],
} as const;

const EVENT_PATCH_PROPERTIES = {
  title: { type: "string" },
  start: ISO_DATE_TIME,
  end: ISO_DATE_TIME,
  description: { type: "string" },
  location: { type: "string" },
  calendarId: { type: "string" },
  isAllDay: { type: "boolean" },
  recurrence: RECURRENCE_SCHEMA,
} as const;

export const TOOL_SCHEMAS = {
  tempo_list_calendars: {
    type: "object",
    properties: {},
  },
  tempo_list_events: {
    type: "object",
    properties: {
      start: ISO_DATE_TIME,
      end: ISO_DATE_TIME,
      calendarId: { type: "string" },
      query: {
        type: "string",
        description: "Case-insensitive substring match on title/description/location.",
      },
    },
    required: ["start", "end"],
  },
  tempo_get_event: {
    type: "object",
    properties: { eventId: { type: "string" } },
    required: ["eventId"],
  },
  tempo_find_conflicts: {
    type: "object",
    properties: {
      start: ISO_DATE_TIME,
      end: ISO_DATE_TIME,
      calendarId: { type: "string" },
    },
    required: ["start", "end"],
  },
  tempo_find_free_time: {
    type: "object",
    properties: {
      rangeStart: ISO_DATE_TIME,
      rangeEnd: ISO_DATE_TIME,
      durationMinutes: { type: "integer", minimum: 1 },
      calendarIds: {
        ...CALENDAR_IDS,
        description: "Calendars whose events count as busy; omission uses all calendars.",
      },
      preferredStartTime: LOCAL_TIME,
      preferredEndTime: LOCAL_TIME,
    },
    required: ["rangeStart", "rangeEnd", "durationMinutes"],
  },
  tempo_push_events: {
    type: "object",
    properties: {
      anchorEventId: {
        type: "string",
        description: "Event id, or an exact occurrence id for a recurring anchor.",
      },
      offsetMinutes: {
        type: "integer",
        description: "Signed non-zero offset; positive moves later, negative moves earlier.",
      },
      scope: {
        type: "string",
        enum: ["same_day", "date_range"],
        description: "Defaults to same_day. date_range requires rangeStart and rangeEnd.",
      },
      rangeStart: ISO_DATE_TIME,
      rangeEnd: ISO_DATE_TIME,
      calendarIds: {
        ...CALENDAR_IDS,
        description: "Calendars to modify; omission uses only the anchor calendar.",
      },
    },
    required: ["anchorEventId", "offsetMinutes"],
  },
  tempo_create_event: {
    type: "object",
    properties: {
      title: { type: "string" },
      start: ISO_DATE_TIME,
      end: ISO_DATE_TIME,
      calendarId: {
        type: "string",
        description: "Defaults to the first visible calendar.",
      },
      isAllDay: { type: "boolean" },
      description: { type: "string" },
      location: { type: "string" },
      recurrence: RECURRENCE_SCHEMA,
    },
    required: ["title", "start", "end"],
  },
  tempo_schedule_event: {
    type: "object",
    properties: {
      title: { type: "string" },
      rangeStart: ISO_DATE_TIME,
      rangeEnd: ISO_DATE_TIME,
      durationMinutes: { type: "integer", minimum: 1 },
      preferredStartTime: LOCAL_TIME,
      preferredEndTime: LOCAL_TIME,
      calendarId: {
        type: "string",
        description: "Destination calendar; defaults to the first visible calendar.",
      },
      busyCalendarIds: {
        ...CALENDAR_IDS,
        description: "Calendars whose events count as busy; omission uses all calendars.",
      },
      description: { type: "string" },
      location: { type: "string" },
    },
    required: ["title", "rangeStart", "rangeEnd", "durationMinutes"],
  },
  tempo_update_event: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description:
          "Base event id. Updates apply to the whole series for recurring events.",
      },
      patch: {
        type: "object",
        properties: EVENT_PATCH_PROPERTIES,
      },
    },
    required: ["eventId", "patch"],
  },
  tempo_move_event: {
    type: "object",
    properties: {
      eventId: { type: "string" },
      start: ISO_DATE_TIME,
      end: ISO_DATE_TIME,
    },
    required: ["eventId", "start", "end"],
  },
  tempo_duplicate_event: {
    type: "object",
    properties: {
      eventId: { type: "string" },
      newStart: {
        ...ISO_DATE_TIME,
        description: "Optional new start time; duration is preserved.",
      },
    },
    required: ["eventId"],
  },
  tempo_delete_event: {
    type: "object",
    properties: {
      eventId: {
        type: "string",
        description: "Deletes the whole series for recurring events.",
      },
    },
    required: ["eventId"],
  },
  tempo_create_calendar: {
    type: "object",
    properties: {
      name: { type: "string" },
      color: {
        type: "string",
        enum: ["red", "orange", "yellow", "green", "blue", "purple", "gray"],
      },
    },
    required: ["name"],
  },
  tempo_update_calendar: {
    type: "object",
    properties: {
      calendarId: { type: "string" },
      name: { type: "string" },
      color: {
        type: "string",
        enum: ["red", "orange", "yellow", "green", "blue", "purple", "gray"],
      },
      visible: { type: "boolean" },
    },
    required: ["calendarId"],
  },
  tempo_delete_calendar: {
    type: "object",
    properties: {
      calendarId: {
        type: "string",
        description: "Deletes the calendar and all of its events.",
      },
    },
    required: ["calendarId"],
  },
  tempo_undo: { type: "object", properties: {} },
  tempo_redo: { type: "object", properties: {} },
} as const;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Wire representation of an event returned to agents. */
export interface SerializedEvent {
  id: string;
  baseId?: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  calendarId?: string;
  calendarName?: string;
  description?: string;
  location?: string;
  recurring: boolean;
  rrule?: RecurrenceRule;
}

export function serializeEvent(
  event: CalendarEvent,
  calendars: Calendar[],
): SerializedEvent {
  const calendar = calendars.find((c) => c.id === event.calendarId);
  return {
    id: event.id,
    baseId: event.baseId,
    title: event.title,
    start: event.start.toISOString(),
    end: event.end.toISOString(),
    isAllDay: event.isAllDay ?? false,
    calendarId: event.calendarId,
    calendarName: calendar?.name,
    description: event.description,
    location: event.location,
    recurring: event.rrule != null,
    rrule: event.rrule,
  };
}

export function serializeCalendar(
  calendar: Calendar,
  eventCount: number,
): Record<string, unknown> {
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color,
    visible: calendar.visible,
    eventCount,
  };
}
