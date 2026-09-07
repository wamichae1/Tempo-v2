import { useCallback, useState } from "react";

import type { CalendarEvent } from "@/components/calendar";
import type { TourStep } from "@/features/onboarding/onboarding-steps";

export const TUTORIAL_EVENT_ID = "tempo:tutorial-example-event";

export function isTutorialEvent(
  event: CalendarEvent | undefined | null,
): event is CalendarEvent & { tutorialOnly: true } {
  return event?.tutorialOnly === true;
}

export function createTutorialEvent(date: Date): CalendarEvent {
  const start = new Date(date);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    id: TUTORIAL_EVENT_ID,
    title: "Try dragging me",
    start,
    end,
    color: "blue",
    tutorialOnly: true,
  };
}

export function useTutorialExampleEvent() {
  const [event, setEvent] = useState<CalendarEvent | null>(null);

  const request = useCallback((date: Date) => {
    setEvent((current) => current ?? createTutorialEvent(date));
  }, []);

  const update = useCallback((next: CalendarEvent) => {
    if (!isTutorialEvent(next)) return false;
    setEvent((current) =>
      current?.id === next.id ? { ...next, tutorialOnly: true } : current,
    );
    return true;
  }, []);

  const clear = useCallback(() => setEvent(null), []);

  const handleStepChange = useCallback((step: TourStep | null) => {
    if (step?.id !== "edit-events") setEvent(null);
  }, []);

  return { event, request, update, clear, handleStepChange };
}
