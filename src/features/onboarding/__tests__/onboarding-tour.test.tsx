// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOUR_STEPS } from "@/features/onboarding/onboarding-steps";
import { OnboardingTour } from "@/features/onboarding/onboarding-tour";
import type { TutorialCloseReason } from "@/features/onboarding/use-onboarding";

describe("OnboardingTour controls", () => {
  let container: HTMLDivElement;
  let root: Root;

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

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
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
});
