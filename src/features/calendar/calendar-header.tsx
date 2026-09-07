import {
  Bot,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Monitor,
  Moon,
  PanelLeft,
  Plus,
  Redo2,
  Sun,
  Undo2,
} from "lucide-react";

import { MiniCalendar } from "@/components/calendar/mini-calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchPopover } from "@/features/calendar/search-popover";
import type { Theme } from "@/hooks/use-theme";
import type { CalendarEvent } from "@/components/calendar";
import type { Calendar } from "@/features/calendar/types";

type MainView = "week" | "month";

export interface CalendarHeaderProps {
  view: MainView;
  monthName: string;
  year: string | number;
  weekNumber: string | number;
  headerDate: Date;
  visibleDays: Date[];
  weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  datePickerOpen: boolean;
  onDatePickerOpenChange: (open: boolean) => void;
  onDateSelect: (date: Date) => void;
  onSwitchView: (view: MainView) => void;
  onCreateEvent: () => void;
  onToday: () => void;
  onPrevious: () => void;
  onNext: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  events: CalendarEvent[];
  calendars: Calendar[];
  onSelectSearchResult: (event: CalendarEvent) => void;
  theme: Theme;
  onCycleTheme: () => void;
  onToggleSidebar: () => void;
  onToggleAssistant: () => void;
  onShowIntro: () => void;
  onStartTutorial: () => void;
  onOpenWebMcpGuide: () => void;
  /** Briefly emphasize the help button (after tutorial completion). */
  highlightHelp?: boolean;
}

/**
 * Workspace app bar: wordmark + panel toggles on the left, date title, and
 * the calendar action cluster on the right.
 */
export function CalendarHeader({
  view,
  monthName,
  year,
  weekNumber,
  headerDate,
  visibleDays,
  weekStartsOn,
  datePickerOpen,
  onDatePickerOpenChange,
  onDateSelect,
  onSwitchView,
  onCreateEvent,
  onToday,
  onPrevious,
  onNext,
  undo,
  redo,
  canUndo,
  canRedo,
  events,
  calendars,
  onSelectSearchResult,
  theme,
  onCycleTheme,
  onToggleSidebar,
  onToggleAssistant,
  onShowIntro,
  onStartTutorial,
  onOpenWebMcpGuide,
  highlightHelp = false,
}: CalendarHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-3">
      <div className="flex min-w-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onToggleSidebar}
          title="Toggle sidebar (Ctrl+B)"
          aria-label="Toggle sidebar"
        >
          <PanelLeft className="size-4" />
        </Button>
        <span className="text-foreground flex items-center gap-1.5 pr-1 text-sm font-semibold tracking-tight">
          <CalendarDays className="size-4" />
          Tempo
        </span>
        <Popover open={datePickerOpen} onOpenChange={onDatePickerOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="hover:bg-accent flex items-center gap-1 rounded-md px-2 py-1 transition-colors"
              title="Choose a date"
            >
              <h1 className="truncate text-base font-semibold tracking-tight">
                {monthName} {year}
              </h1>
              <ChevronDown className="text-muted-foreground size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <MiniCalendar
              currentDate={headerDate}
              visibleDays={view === "week" ? visibleDays : []}
              onSelect={onDateSelect}
              weekStartsOn={weekStartsOn}
            />
          </PopoverContent>
        </Popover>
        {view === "week" && (
          <span className="text-muted-foreground label-mono hidden sm:inline">
            Week {weekNumber}
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onToggleAssistant}
          title="Tempo Agent (Ctrl+J)"
          aria-label="Tempo Agent"
          data-tour="agent-toggle"
        >
          <Bot className="size-4" />
        </Button>
        <SearchPopover
          events={events}
          calendars={calendars}
          onSelectResult={onSelectSearchResult}
        />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onCycleTheme}
          title={`Theme: ${theme}`}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <Moon className="size-4" />
          ) : theme === "system" ? (
            <Monitor className="size-4" />
          ) : (
            <Sun className="size-4" />
          )}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={
                highlightHelp
                  ? "ring-ring size-8 animate-pulse ring-2"
                  : "size-8"
              }
              title="Help & guides"
              aria-label="Help & guides"
            >
              <CircleHelp className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Help &amp; Guides</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onStartTutorial}>
              <div className="flex flex-col gap-0.5">
                <span>Tempo Tutorial</span>
                <span className="text-muted-foreground text-[11px]">
                  Learn the basics of Tempo
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onOpenWebMcpGuide}>
              <div className="flex flex-col gap-0.5">
                <span>WebMCP Guide</span>
                <span className="text-muted-foreground text-[11px]">
                  Set up Tempo with AI agents
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onShowIntro}>
              Welcome screen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="bg-border mx-1.5 h-4 w-px" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="sm" data-tour="view-switcher">
              {view === "week" ? "Week" : "Month"}
              <ChevronDown className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onSwitchView("week")}>
              Week
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onSwitchView("month")}>
              Month
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="default"
          size="sm"
          onClick={onCreateEvent}
          data-tour="new-event"
        >
          <Plus className="size-4" />
          New event
        </Button>
        <Button variant="secondary" size="sm" onClick={onToday}>
          Today
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onPrevious}
        >
          <ChevronLeft className="size-4" />
          <span className="sr-only">Previous</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onNext}
        >
          <ChevronRight className="size-4" />
          <span className="sr-only">Next</span>
        </Button>
      </div>
    </header>
  );
}
