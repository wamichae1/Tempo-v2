import type { TourStep } from "@/features/onboarding/onboarding-steps";

const PAD = 6;

export interface TourTargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface MeasuredTourTarget {
  element: HTMLElement;
  rect: TourTargetRect;
  source: "primary" | "fallback";
}

function visibleRect(element: HTMLElement): DOMRect | null {
  if (!element.isConnected) return null;

  let current: HTMLElement | null = element;
  while (current) {
    if (current.hidden || current.getAttribute("aria-hidden") === "true") {
      return null;
    }
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.opacity === "0"
    ) {
      return null;
    }
    current = current.parentElement;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const visibleWidth =
    Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
  const visibleHeight =
    Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  if (visibleWidth <= 0 || visibleHeight <= 0) return null;
  return rect;
}

function findBestTarget(target: string): MeasuredTourTarget | null {
  let best: { element: HTMLElement; rect: DOMRect; area: number } | null = null;
  const candidates = document.querySelectorAll<HTMLElement>(
    `[data-tour="${target}"]`,
  );

  for (const element of candidates) {
    const rect = visibleRect(element);
    if (!rect) continue;
    const visibleWidth =
      Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
    const visibleHeight =
      Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    const area = visibleWidth * visibleHeight;
    if (!best || area > best.area) best = { element, rect, area };
  }

  if (!best) return null;
  return {
    element: best.element,
    source: "primary",
    rect: {
      top: best.rect.top - PAD,
      left: best.rect.left - PAD,
      width: best.rect.width + PAD * 2,
      height: best.rect.height + PAD * 2,
    },
  };
}

/** Find the largest actually visible target, then use the configured fallback. */
export function findVisibleTourTarget(
  step: TourStep,
): MeasuredTourTarget | null {
  const primary = findBestTarget(step.target);
  if (primary) return primary;
  if (!step.fallbackTarget) return null;
  const fallback = findBestTarget(step.fallbackTarget);
  return fallback ? { ...fallback, source: "fallback" } : null;
}
