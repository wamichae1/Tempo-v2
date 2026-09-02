import * as React from "react";
import { format, isToday, isTomorrow } from "date-fns";
import { CalendarDays, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { CalendarEvent } from "@/components/calendar";
import type { Calendar } from "@/features/calendar/types";
import { searchEvents } from "@/lib/search";

const dotClass: Record<string, string> = {
  red: "bg-event-red-border",
  orange: "bg-event-orange-border",
  yellow: "bg-event-yellow-border",
  green: "bg-event-green-border",
  blue: "bg-event-blue-border",
  purple: "bg-event-purple-border",
  gray: "bg-event-gray-border",
};

function formatResultDate(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  return format(date, "EEE, MMM d");
}

export interface SearchPopoverProps {
  events: CalendarEvent[];
  calendars: Calendar[];
  /** Jump to a result: navigate to its date and select the occurrence. */
  onSelectResult: (event: CalendarEvent) => void;
}

/**
 * Header search. Matches title, description, location and calendar name via
 * the reusable `searchEvents` library; selecting a result navigates the
 * calendar to the event.
 */
export function SearchPopover({
  events,
  calendars,
  onSelectResult,
}: SearchPopoverProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");

  const results = React.useMemo(
    () => searchEvents(events, calendars, query),
    [events, calendars, query],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" title="Search events">
          <Search className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-2">
        <input
          autoFocus
          placeholder="Search events…"
          className="w-full rounded-sm border bg-transparent px-2 py-1.5 text-xs outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results.length > 0) {
              onSelectResult(results[0].event);
              setOpen(false);
            }
          }}
        />
        <div className="mt-1 max-h-72 overflow-y-auto">
          {query.trim() && results.length === 0 && (
            <p className="text-muted-foreground px-2 py-3 text-xs">
              No events match “{query}”.
            </p>
          )}
          {results.map(({ event, calendarName }) => (
            <button
              key={event.id}
              type="button"
              className="hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left"
              onClick={() => {
                onSelectResult(event);
                setOpen(false);
              }}
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  dotClass[event.color ?? "blue"],
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">
                  {event.title || "(No title)"}
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  <CalendarDays className="mr-1 inline size-3" />
                  {formatResultDate(event.start)}
                  {!event.isAllDay && ` · ${format(event.start, "h:mm a")}`}
                  {calendarName && ` · ${calendarName}`}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
