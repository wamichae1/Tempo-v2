// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOUR_STEPS } from "@/features/onboarding/onboarding-steps";
import { OnboardingTour } from "@/features/onboarding/onboarding-tour";
import { findVisibleTourTarget } from "@/features/onboarding/tour-targeting";
import type { TutorialCloseReason } from "@/features/onboarding/use-onboarding";

describe("OnboardingTour controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextFrameId: number;
  let pendingFrames: Map<number, FrameRequestCallback>;

  const renderTour = async (
    onClose: (reason: TutorialCloseReason) => void = vi.fn(),
  ) => {
    await act(async () => {
      root.render(<OnboardingTour onClose={onClose} />);
    });
    return onClose;
  };

  const getButton = (label: string) =>
    document.body.querySelector(
      `button[aria-label="${label}"]`,
    ) as HTMLButtonElement | null;

  interface RectInput {
    top: number;
    left: number;
    width: number;
    height: number;
  }

  const setRect = (
    element: HTMLElement,
    { top, left, width, height }: RectInput,
  ) => {
    const rect = {
      x: left,
      y: top,
      top,
      left,
      width,
      height,
      right: left + width,
      bottom: top + height,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  };

  const flushFrames = async (rounds = 1) => {
    for (let round = 0; round < rounds; round += 1) {
      await act(async () => {
        const callbacks = [...pendingFrames.values()];
        pendingFrames.clear();
        callbacks.forEach((callback) => callback(performance.now()));
        await Promise.resolve();
      });
    }
  };

  beforeEach(() => {
    nextFrameId = 0;
    pendingFrames = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrameId += 1;
      pendingFrames.set(nextFrameId, callback);
      return nextFrameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      pendingFrames.delete(id);
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("renders Skip all without a temporary Skip control", async () => {
    await renderTour();

    expect(getButton("Skip tutorial")).toBeNull();
    expect(getButton("Skip tutorial and don't show it again")).not.toBeNull();
    const buttonLabels = Array.from(
      document.body.querySelectorAll("button"),
      (button) => button.textContent?.trim(),
    );
    expect(buttonLabels).not.toContain("Skip");
    expect(buttonLabels).toContain("Skip all");
  });

  it("closes permanently when Skip all is clicked", async () => {
    const onClose = vi.fn<(reason: TutorialCloseReason) => void>();
    await renderTour(onClose);

    await act(async () => {
      getButton("Skip tutorial and don't show it again")?.click();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("skip-all");
  });

  it("does not close when Escape is pressed", async () => {
    const onClose = vi.fn<(reason: TutorialCloseReason) => void>();
    await renderTour(onClose);

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("advances with Next and completes with Finish", async () => {
    const onClose = vi.fn<(reason: TutorialCloseReason) => void>();
    await renderTour(onClose);

    for (let step = 1; step < TOUR_STEPS.length; step += 1) {
      expect(getButton("Next tutorial step")).not.toBeNull();
      await act(async () => {
        getButton("Next tutorial step")?.click();
      });
    }

    expect(getButton("Next tutorial step")).toBeNull();
    expect(getButton("Finish tutorial")).not.toBeNull();

    await act(async () => {
      getButton("Finish tutorial")?.click();
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("complete");
  });

  it("ignores hidden and stale matches and selects the visible event", () => {
    const hidden = document.createElement("div");
    hidden.dataset.tour = "event-item";
    hidden.hidden = true;
    setRect(hidden, { top: 20, left: 20, width: 500, height: 200 });
    document.body.appendChild(hidden);

    const visible = document.createElement("div");
    visible.dataset.tour = "event-item";
    setRect(visible, { top: 100, left: 200, width: 120, height: 60 });
    document.body.appendChild(visible);

    const measured = findVisibleTourTarget(TOUR_STEPS[2]);
    expect(measured?.element).toBe(visible);
    expect(measured?.source).toBe("primary");
    expect(measured?.rect).toMatchObject({
      top: 94,
      left: 194,
      width: 132,
      height: 72,
    });
  });

  it("requests, renders, and spotlights an example event when Step 3 has no visible event", async () => {
    const calendar = document.createElement("div");
    calendar.dataset.tour = "calendar";
    setRect(calendar, { top: 40, left: 40, width: 800, height: 600 });
    document.body.appendChild(calendar);

    const newEvent = document.createElement("button");
    newEvent.dataset.tour = "new-event";
    setRect(newEvent, { top: 10, left: 700, width: 100, height: 32 });
    document.body.appendChild(newEvent);

    const requestExample = vi.fn(() => {
      const event = document.createElement("div");
      event.dataset.tour = "event-item";
      event.textContent = "Try dragging me";
      setRect(event, { top: 180, left: 260, width: 140, height: 64 });
      document.body.appendChild(event);
    });

    await act(async () => {
      root.render(
        <OnboardingTour
          onClose={vi.fn()}
          onRequestExampleEvent={requestExample}
        />,
      );
    });
    await flushFrames(2);

    await act(async () => getButton("Next tutorial step")?.click());
    await flushFrames(2);
    await act(async () => getButton("Next tutorial step")?.click());
    await flushFrames(5);

    expect(requestExample).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain("Try dragging me");
    const spotlight = document.body.querySelector(
      '[data-testid="onboarding-spotlight"]',
    ) as HTMLElement | null;
    expect(spotlight?.style.top).toBe("174px");
    expect(spotlight?.style.left).toBe("254px");
    expect(spotlight?.style.width).toBe("152px");
    expect(spotlight?.style.height).toBe("76px");
  });

  it("prefers a visible real event without requesting an example", async () => {
    const calendar = document.createElement("div");
    calendar.dataset.tour = "calendar";
    setRect(calendar, { top: 40, left: 40, width: 800, height: 600 });
    document.body.appendChild(calendar);

    const newEvent = document.createElement("button");
    newEvent.dataset.tour = "new-event";
    setRect(newEvent, { top: 10, left: 700, width: 100, height: 32 });
    document.body.appendChild(newEvent);

    const realEvent = document.createElement("div");
    realEvent.dataset.tour = "event-item";
    realEvent.textContent = "Existing meeting";
    setRect(realEvent, { top: 220, left: 320, width: 160, height: 72 });
    document.body.appendChild(realEvent);

    const requestExample = vi.fn();
    await act(async () => {
      root.render(
        <OnboardingTour
          onClose={vi.fn()}
          onRequestExampleEvent={requestExample}
        />,
      );
    });
    await flushFrames(2);
    await act(async () => getButton("Next tutorial step")?.click());
    await flushFrames(2);
    await act(async () => getButton("Next tutorial step")?.click());
    await flushFrames(4);

    expect(requestExample).not.toHaveBeenCalled();
    const spotlight = document.body.querySelector(
      '[data-testid="onboarding-spotlight"]',
    ) as HTMLElement | null;
    expect(spotlight?.style.top).toBe("214px");
    expect(spotlight?.style.left).toBe("314px");
  });

  it("waits for the prepared Agent panel and then targets its Settings button", async () => {
    const agentParent = document.createElement("div");
    agentParent.hidden = true;
    const agent = document.createElement("div");
    agent.dataset.tour = "agent-panel";
    setRect(agent, { top: 80, left: 700, width: 280, height: 620 });
    const settings = document.createElement("button");
    settings.dataset.tour = "agent-settings";
    setRect(settings, { top: 120, left: 930, width: 24, height: 24 });
    agent.appendChild(settings);
    agentParent.appendChild(agent);
    document.body.appendChild(agentParent);

    await act(async () => {
      root.render(
        <OnboardingTour
          onClose={vi.fn()}
          onPrepareStep={(step) => {
            if (step.prepare === "expand-assistant") {
              agentParent.hidden = false;
            }
          }}
        />,
      );
    });

    for (let step = 0; step < 4; step += 1) {
      await act(async () => getButton("Next tutorial step")?.click());
      await flushFrames(2);
    }

    const spotlight = () =>
      document.body.querySelector(
        '[data-testid="onboarding-spotlight"]',
      ) as HTMLElement | null;
    expect(spotlight()?.style.left).toBe("694px");
    expect(spotlight()?.style.width).toBe("292px");

    await act(async () => getButton("Next tutorial step")?.click());
    await flushFrames(3);
    expect(spotlight()?.style.top).toBe("114px");
    expect(spotlight()?.style.left).toBe("924px");
    expect(spotlight()?.style.width).toBe("36px");
  });
});
