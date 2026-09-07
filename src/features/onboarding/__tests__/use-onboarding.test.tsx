// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  LS_TUTORIAL_DONE,
  useOnboarding,
} from "@/features/onboarding/use-onboarding";

function OnboardingHarness() {
  const onboarding = useOnboarding();

  return (
    <div>
      <output data-testid="tour-state">
        {onboarding.tourOpen ? "open" : "closed"}
      </output>
      <button type="button" onClick={onboarding.startTutorial}>
        Start
      </button>
      <button type="button" onClick={onboarding.maybeAutoStartTutorial}>
        Auto start
      </button>
      <button
        type="button"
        onClick={() => onboarding.closeTutorial("skip-all")}
      >
        Skip all
      </button>
      <button
        type="button"
        onClick={() => onboarding.closeTutorial("complete")}
      >
        Complete
      </button>
    </div>
  );
}

describe("useOnboarding tutorial persistence", () => {
  let container: HTMLDivElement;
  let root: Root;

  const renderHarness = async () => {
    await act(async () => {
      root.render(<OnboardingHarness />);
    });
  };

  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent === label,
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
  };

  const tourState = () =>
    container.querySelector('[data-testid="tour-state"]')?.textContent;

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

  it.each(["Skip all", "Complete"])(
    "persists tutorial completion after %s",
    async (action) => {
      await renderHarness();
      await click("Start");
      expect(tourState()).toBe("open");

      await click(action);

      expect(tourState()).toBe("closed");
      expect(localStorage.getItem(LS_TUTORIAL_DONE)).toBe("1");
    },
  );

  it("suppresses automatic launch after persistence but allows manual reopening", async () => {
    localStorage.setItem(LS_TUTORIAL_DONE, "1");
    await renderHarness();

    await click("Auto start");
    expect(tourState()).toBe("closed");

    await click("Start");
    expect(tourState()).toBe("open");
  });
});
