"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { format, isSameMonth, isToday, startOfDay } from "date-fns";

import { cn } from "@/lib/utils";
import {
  calculateMonthCellLayout,
  generateMonthGrid,
  getMonthSlotCount,
  MONTH_EVENT_ROW_HEIGHT,
  type MonthCellSlot,
} from "@/lib/event-utils";
import { useCalendarData } from "@/features/calendar/calendar-data-context";
import { CalendarPopoverBoundaryProvider } from "./calendar-popover-context";
import { eventColorStyles } from "./calendar-event-item";
import { EventDetailPanel } from "./event-detail-panel";
import { EventContextMenu } from "./event-context-menu";
import type { CalendarEvent, EventColor } from "./week-view-types";

export interface MonthViewProps {
  /** Any date within the month to display. */
  currentDate: Date;
  /** Events to display (already expanded/filtered by the parent). */
  events: CalendarEvent[];
  selectedEventId?: string;
  onEventClick?: (event: CalendarEvent) => void;
  onEventChange?: (event: CalendarEvent) => void;
  onEventDelete?: (event: CalendarEvent) => void;
  /** Jump to a specific day (used by "+N more" and day-number clicks). */
  onNavigateToDate?: (date: Date) => void;
  onClosePopover?: () => void;
  className?: string;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Full-month calendar grid. Reuses the month layout utilities from
 * `event-utils` (spanning bars, slot allocation, "+N more" overflow) and the
 * shared event detail panel / context menu.
 */
export function MonthView({
  currentDate,
  events,
  selectedEventId,
  onEventClick,
  onEventChange,
  onEventDelete,
  onNavigateToDate,
  onClosePopover,
  className,
}: MonthViewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = React.useState(0);
  const boundaryRef = React.useRef<HTMLDivElement>(null);
  const headerRef = React.useRef<HTMLDivElement>(null);

  const [detailPos, setDetailPos] = React.useState<{ x: number; y: number } | null>(null);
  const [contextMenu, setContextMenu] = React.useState<{
    event: CalendarEvent;
    x: number;
    y: number;
  } | null>(null);

  const { conflictIds } = useCalendarData();

  const weeks = React.useMemo(() => generateMonthGrid(currentDate, 0), [currentDate]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowHeight = weeks.length > 0 ? containerHeight / weeks.length : 0;
  const maxSlots = getMonthSlotCount(rowHeight);

  const layout = React.useMemo(
    () => calculateMonthCellLayout(weeks, events, maxSlots),
    [weeks, events, maxSlots],
  );

  const selectedEvent = React.useMemo(
    () => events.find((e) => e.id === selectedEventId),
    [events, selectedEventId],
  );

  const handleEventClick = (e: React.MouseEvent, event: CalendarEvent) => {
    e.stopPropagation();
    onEventClick?.(event);
    setDetailPos({ x: e.clientX, y: e.clientY });
  };

  const handleContextMenu = (e: React.MouseEvent, event: CalendarEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ event, x: e.clientX, y: e.clientY });
  };

  const renderBar = (slot: Extract<MonthCellSlot, { type: "event-bar" }>) => {
    const color: EventColor = slot.event.color ?? "blue";
    const styles = eventColorStyles[color];
    const isSelected = slot.event.id === selectedEventId;
    return (
      <div
        key={slot.event.id}
        role="button"
        tabIndex={0}
        className={cn(
          "pointer-events-auto absolute flex h-5 cursor-pointer items-center truncate px-1.5 text-[11px] font-medium",
          styles.bg,
          styles.text,
          slot.roundedLeft ? "rounded-l-[3px]" : "",
          slot.roundedRight ? "rounded-r-[3px]" : "",
          isSelected && "ring-1 ring-current",
          conflictIds.has(slot.event.id) && "outline outline-1 outline-red-500",
        )}
        style={{ width: `calc(${slot.colSpan * 100}% + ${slot.colSpan - 1}px)` }}
        title={slot.event.title || "(No title)"}
        onClick={(e) => handleEventClick(e, slot.event)}
        onContextMenu={(e) => handleContextMenu(e, slot.event)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onEventClick?.(slot.event);
        }}
      >
        {slot.event.title || "(No title)"}
      </div>
    );
  };

  return (
    <CalendarPopoverBoundaryProvider
      boundaryRef={boundaryRef}
      headerRef={headerRef}
      view="month"
    >
      <div
        ref={boundaryRef}
        className={cn("flex h-full flex-col", className)}
        onClick={() => {
          onClosePopover?.();
          setDetailPos(null);
        }}
      >
        {/* Weekday header */}
        <div ref={headerRef} className="grid shrink-0 grid-cols-7 border-b">
          {WEEKDAY_NAMES.map((name) => (
            <div
              key={name}
              className="text-muted-foreground px-2 py-1 text-center text-[11px] font-medium"
            >
              {name}
            </div>
          ))}
        </div>

        {/* Month grid */}
        <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
          {weeks.map((week) => (
            <div
              key={week.days[0].date.toISOString()}
              className="grid min-h-0 flex-1 grid-cols-7 border-b last:border-b-0"
            >
              {week.days.map((day) => {
                const key = startOfDay(day.date).toISOString();
                const cell = layout.get(key);
                const inMonth = isSameMonth(day.date, currentDate);
                return (
                  <div
                    key={key}
                    className={cn(
                      "relative flex min-h-0 flex-col gap-px overflow-hidden border-l px-1 pb-1 first:border-l-0",
                      !inMonth && "bg-muted/40",
                      (day.date.getDay() === 0 || day.date.getDay() === 6) &&
                        "bg-calendar-weekend",
                    )}
                  >
                    <button
                      type="button"
                      className={cn(
                        "mx-auto mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-[11px]",
                        isToday(day.date)
                          ? "bg-primary text-primary-foreground font-semibold"
                          : inMonth
                            ? "text-foreground hover:bg-accent"
                            : "text-muted-foreground hover:bg-accent",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToDate?.(day.date);
                      }}
                      title="Open in week view"
                    >
                      {day.dayNumber === 1
                        ? format(day.date, "MMM d")
                        : day.dayNumber}
                    </button>

                    {/* Spanning bars (relative rows; bars overflow to span columns) */}
                    <div className="relative">
                      {cell?.barSlots.map((slot, i) =>
                        slot.type === "event-bar" ? (
                          <div key={`bar-${i}`} className="relative h-[21px]">
                            {renderBar(slot)}
                          </div>
                        ) : (
                          <div key={`bar-${i}`} className="h-[21px]" />
                        ),
                      )}
                    </div>

                    {/* Timed events + overflow */}
                    {cell?.eventSlots.map((slot, i) => {
                      if (slot.type === "event-item") {
                        const color: EventColor = slot.event.color ?? "blue";
                        const styles = eventColorStyles[color];
                        const isSelected = slot.event.id === selectedEventId;
                        return (
                          <button
                            key={`ev-${i}`}
                            type="button"
                            className={cn(
                              "flex w-full items-center gap-1 truncate rounded-[3px] px-1 text-left text-[11px]",
                              "hover:bg-accent",
                              isSelected && "bg-accent ring-1 ring-current",
                            )}
                            style={{ height: MONTH_EVENT_ROW_HEIGHT - 1 }}
                            onClick={(e) => handleEventClick(e, slot.event)}
                            onContextMenu={(e) => handleContextMenu(e, slot.event)}
                            title={slot.event.title || "(No title)"}
                          >
                            <span
                              className={cn(
                                "size-2 shrink-0 rounded-full",
                                styles.border,
                                conflictIds.has(slot.event.id) &&
                                  "outline outline-2 outline-red-500",
                              )}
                            />
                            <span className="text-muted-foreground shrink-0">
                              {format(slot.event.start, "h:mm a")}
                            </span>
                            <span className="text-foreground truncate">
                              {slot.event.title || "(No title)"}
                            </span>
                          </button>
                        );
                      }
                      if (slot.type === "more") {
                        return (
                          <button
                            key={`more-${i}`}
                            type="button"
                            className="text-muted-foreground hover:bg-accent h-5 w-full rounded-[3px] px-1 text-left text-[11px]"
                            onClick={(e) => {
                              e.stopPropagation();
                              onNavigateToDate?.(day.date);
                            }}
                          >
                            +{slot.count} more
                          </button>
                        );
                      }
                      return <div key={`sp-${i}`} className="h-5" />;
                    })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Floating event detail panel */}
        {selectedEvent &&
          detailPos &&
          createPortal(
            <div
              className="bg-popover fixed z-50 max-h-[80vh] w-[320px] overflow-y-auto rounded-lg border shadow-lg"
              style={{
                top: Math.max(8, Math.min(detailPos.y, window.innerHeight - 440)),
                left: Math.max(8, Math.min(detailPos.x, window.innerWidth - 340)),
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <EventDetailPanel
                event={selectedEvent}
                onEventChange={onEventChange}
                onEventDelete={(ev) => {
                  onEventDelete?.(ev);
                  setDetailPos(null);
                }}
                onClose={() => {
                  setDetailPos(null);
                  onClosePopover?.();
                }}
              />
            </div>,
            document.body,
          )}

        {/* Context menu */}
        {contextMenu && (
          <EventContextMenu
            event={contextMenu.event}
            position={{ x: contextMenu.x, y: contextMenu.y }}
            onClose={() => setContextMenu(null)}
            onEventChange={onEventChange}
            onEventDelete={onEventDelete}
          />
        )}
      </div>
    </CalendarPopoverBoundaryProvider>
  );
}
