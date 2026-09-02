"use client";

import * as React from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface MiniCalendarProps {
  /** The date whose week/month context is shown. */
  currentDate: Date;
  /** Days currently visible in the main calendar (highlighted in the grid). */
  visibleDays?: Date[];
  /** A selected day to highlight (e.g. in a date-picker popover). */
  selectedDate?: Date;
  /** Called when the user picks a day. */
  onSelect: (date: Date) => void;
  /** Number of days the week starts on (0 = Sunday). */
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * Compact month grid used as a date picker in the header popover.
 * Highlights today and the currently visible week.
 */
export function MiniCalendar({
  currentDate,
  visibleDays = [],
  selectedDate,
  onSelect,
  weekStartsOn = 0,
}: MiniCalendarProps) {
  const [displayedMonth, setDisplayedMonth] = React.useState(() =>
    startOfMonth(currentDate),
  );

  // Follow external navigation when the popover's context date changes months
  React.useEffect(() => {
    setDisplayedMonth((month) =>
      isSameMonth(month, currentDate) ? month : startOfMonth(currentDate),
    );
  }, [currentDate]);

  const gridDays = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(displayedMonth), { weekStartsOn });
    const end = endOfWeek(endOfMonth(displayedMonth), { weekStartsOn });
    return eachDayOfInterval({ start, end });
  }, [displayedMonth, weekStartsOn]);

  const weekdayLabels = React.useMemo(() => {
    const start = startOfWeek(new Date(), { weekStartsOn });
    return eachDayOfInterval({ start, end: endOfWeek(new Date(), { weekStartsOn }) }).map(
      (day) => format(day, "EEEEE"),
    );
  }, [weekStartsOn]);

  const isVisibleDay = (day: Date) =>
    visibleDays.some((visible) => isSameDay(visible, day));

  return (
    <div className="w-[240px] select-none p-3">
      <div className="flex items-center justify-between pb-2">
        <span className="text-xs font-medium">
          {format(displayedMonth, "MMMM yyyy")}
        </span>
        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setDisplayedMonth((m) => addMonths(m, -1))}
          >
            <ChevronLeft className="size-3.5" />
            <span className="sr-only">Previous month</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setDisplayedMonth((m) => addMonths(m, 1))}
          >
            <ChevronRight className="size-3.5" />
            <span className="sr-only">Next month</span>
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {weekdayLabels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="text-muted-foreground flex h-7 items-center justify-center text-[10px]"
          >
            {label}
          </span>
        ))}
        {gridDays.map((day) => {
          const inMonth = isSameMonth(day, displayedMonth);
          const today = isToday(day);
          const inVisibleWeek = isVisibleDay(day);
          const selected = selectedDate ? isSameDay(day, selectedDate) : false;
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={selected}
              className={cn(
                "flex h-7 items-center justify-center rounded-full text-[11px] outline-none transition-colors",
                "focus-visible:ring-ring focus-visible:ring-2",
                inMonth ? "text-foreground" : "text-muted-foreground/50",
                !today && "hover:bg-accent",
                inVisibleWeek && !today && "bg-accent/60",
                today && "bg-primary text-primary-foreground font-semibold",
                selected && !today && "bg-foreground text-background font-semibold",
                selected && today && "ring-ring ring-2 ring-offset-1",
              )}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
