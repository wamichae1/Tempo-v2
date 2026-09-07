// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CalendarEvent } from "@/components/calendar";
import { useCalendarEvents } from "@/features/calendar/use-calendar-events";
import type { TourStep } from "@/features/onboarding/onboarding-steps";
import {
  createTutorialEvent,
  isTutorialEvent,
  TUTORIAL_EVENT_ID,
  useTutorialExampleEvent,
} from "@/features/onboarding/tutorial-event";

describe("tutorial example event", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("creates a marked one-hour event on the requested visible date", () => {
    const date = new Date(2026, 8, 7, 16, 30);
    const event = createTutorialEvent(date);

    expect(event).toMatchObject({
      id: TUTORIAL_EVENT_ID,
      title: "Try dragging me",
      tutorialOnly: true,
    });
    expect(event.start).toEqual(new Date(2026, 8, 7, 9, 0));
    expect(event.end.getTime() - event.start.getTime()).toBe(60 * 60 * 1000);
    expect(isTutorialEvent(event)).toBe(true);
  });

  it("updates locally and cleans up when Step 3 ends, Skip all, or Finish", async () => {
    let controller: ReturnType<typeof useTutorialExampleEvent> | null = null;
    const Harness = () => {
      controller = useTutorialExampleEvent();
      return <div>{controller.event?.title ?? "none"}</div>;
    };

    await act(async () => root.render(<Harness />));
    const date = new Date(2026, 8, 7);
    await act(async () => controller?.request(date));
    expect(container.textContent).toBe("Try dragging me");

    const moved = {
      ...controller!.event!,
      start: new Date(2026, 8, 7, 10, 0),
      end: new Date(2026, 8, 7, 11, 0),
    };
    await act(async () => {
      expect(controller?.update(moved)).toBe(true);
    });
    expect(controller!.event?.start).toEqual(moved.start);

    const stepFour = { id: "views" } as TourStep;
    await act(async () => controller?.handleStepChange(stepFour));
    expect(controller!.event).toBeNull();

    await act(async () => controller?.request(date));
    await act(async () => controller?.clear()); // Skip all
    expect(controller!.event).toBeNull();

    await act(async () => controller?.request(date));
    await act(async () => controller?.clear()); // Finish
    expect(controller!.event).toBeNull();
  });

  it("does not alter an existing real event", async () => {
    let controller: ReturnType<typeof useTutorialExampleEvent> | null = null;
    const Harness = () => {
      controller = useTutorialExampleEvent();
      return null;
    };
    await act(async () => root.render(<Harness />));

    const date = new Date(2026, 8, 7);
    await act(async () => controller?.request(date));
    const tutorialBefore = controller!.event;
    const realEvent: CalendarEvent = {
      id: "real-event",
      title: "Real meeting",
      start: new Date(2026, 8, 7, 13, 0),
      end: new Date(2026, 8, 7, 14, 0),
    };

    await act(async () => {
      expect(controller?.update(realEvent)).toBe(false);
    });
    expect(controller!.event).toBe(tutorialBefore);
    expect(realEvent.title).toBe("Real meeting");
  });

  it("rejects tutorial-only events from the persistent calendar store", async () => {
    let store: ReturnType<typeof useCalendarEvents> | null = null;
    const Harness = () => {
      store = useCalendarEvents();
      return <div>{store.events.length}</div>;
    };
    await act(async () => root.render(<Harness />));

    const event = createTutorialEvent(new Date(2026, 8, 7));
    await act(async () => store?.addEvent(event));

    expect(store!.events).toHaveLength(0);
    expect(localStorage.getItem("tempo:events")).not.toContain(
      TUTORIAL_EVENT_ID,
    );
  });
});
