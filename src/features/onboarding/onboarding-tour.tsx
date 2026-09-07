import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  TOUR_STEPS,
  type TourStep,
} from "@/features/onboarding/onboarding-steps";
import {
  findVisibleTourTarget,
  type TourTargetRect,
} from "@/features/onboarding/tour-targeting";
import type { TutorialCloseReason } from "@/features/onboarding/use-onboarding";
import { cn } from "@/lib/utils";

const TOOLTIP_W = 300;
const TOOLTIP_GAP = 12;
const VIEWPORT_MARGIN = 12;

const clamp = (v: number, min: number, max: number) =>
  Math.min(Math.max(v, min), Math.max(min, max));

/** Position the tooltip near the spotlight, clamped into the viewport. */
function placeTooltip(
  spot: TourTargetRect | null,
  tip: { width: number; height: number },
  preferred: TourStep["preferredSide"],
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!spot) {
    return {
      top: Math.max(VIEWPORT_MARGIN, (vh - tip.height) / 2),
      left: Math.max(VIEWPORT_MARGIN, (vw - tip.width) / 2),
    };
  }
  let top: number;
  let left: number;
  switch (preferred) {
    case "left":
      left = spot.left - tip.width - TOOLTIP_GAP;
      if (left < VIEWPORT_MARGIN) left = spot.left + spot.width + TOOLTIP_GAP;
      top = spot.top + spot.height / 2 - tip.height / 2;
      break;
    case "right":
      left = spot.left + spot.width + TOOLTIP_GAP;
      if (left + tip.width > vw - VIEWPORT_MARGIN)
        left = spot.left - tip.width - TOOLTIP_GAP;
      top = spot.top + spot.height / 2 - tip.height / 2;
      break;
    case "top":
      top = spot.top - tip.height - TOOLTIP_GAP;
      if (top < VIEWPORT_MARGIN) top = spot.top + spot.height + TOOLTIP_GAP;
      left = spot.left + spot.width / 2 - tip.width / 2;
      break;
    case "bottom":
    default:
      top = spot.top + spot.height + TOOLTIP_GAP;
      if (top + tip.height > vh - VIEWPORT_MARGIN)
        top = spot.top - tip.height - TOOLTIP_GAP;
      left = spot.left + spot.width / 2 - tip.width / 2;
      break;
  }
  return {
    top: clamp(top, VIEWPORT_MARGIN, vh - tip.height - VIEWPORT_MARGIN),
    left: clamp(left, VIEWPORT_MARGIN, vw - tip.width - VIEWPORT_MARGIN),
  };
}

export interface OnboardingTourProps {
  onClose: (reason: TutorialCloseReason) => void;
  /** Runs before measuring a step (e.g. expand the Agent panel). */
  onPrepareStep?: (step: TourStep) => void;
  /** Reports the active step, and null when that step is left or unmounted. */
  onStepChange?: (step: TourStep | null) => void;
  /** Requests the temporary Step 3 event after no real target is visible. */
  onRequestExampleEvent?: () => void;
}

/**
 * Spotlight onboarding tour. A translucent overlay dims the app while one
 * real UI element is highlighted through a cutout, with a tooltip card
 * positioned from the target's live `getBoundingClientRect()`. The overlay
 * blocks background interaction. Focus stays inside the tooltip while the
 * tour is active.
 */
export function OnboardingTour({
  onClose,
  onPrepareStep,
  onStepChange,
  onRequestExampleEvent,
}: OnboardingTourProps) {
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<TourTargetRect | null>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number }>({
    top: VIEWPORT_MARGIN,
    left: VIEWPORT_MARGIN,
  });
  const tipRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const measuredElementRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const scheduledFrameRef = useRef<number | null>(null);
  const scheduleMeasurementRef = useRef<() => void>(() => {});
  const missingPassesRef = useRef(0);
  const requestedExampleRef = useRef(false);
  const prepareStepRef = useRef(onPrepareStep);
  const stepChangeRef = useRef(onStepChange);
  const requestExampleRef = useRef(onRequestExampleEvent);
  const step = TOUR_STEPS[index];
  const isLast = index === TOUR_STEPS.length - 1;

  useEffect(() => {
    prepareStepRef.current = onPrepareStep;
    stepChangeRef.current = onStepChange;
    requestExampleRef.current = onRequestExampleEvent;
  }, [onPrepareStep, onRequestExampleEvent, onStepChange]);

  const remeasure = useCallback(() => {
    const measured = findVisibleTourTarget(step);
    const hasPrimary = measured?.source === "primary";
    if (hasPrimary) {
      missingPassesRef.current = 0;
    } else if (
      step.createExampleWhenMissing &&
      !requestedExampleRef.current
    ) {
      missingPassesRef.current += 1;
      if (missingPassesRef.current >= 2) {
        requestedExampleRef.current = true;
        requestExampleRef.current?.();
      } else {
        scheduleMeasurementRef.current();
      }
    }

    setSpot(measured?.rect ?? null);

    if (measured?.element !== measuredElementRef.current) {
      measuredElementRef.current = measured?.element ?? null;
      resizeObserverRef.current?.disconnect();
      if (typeof ResizeObserver !== "undefined" && measured?.element) {
        const observer = new ResizeObserver(() =>
          scheduleMeasurementRef.current(),
        );
        let current: HTMLElement | null = measured.element;
        while (current) {
          observer.observe(current);
          current = current.parentElement;
        }
        resizeObserverRef.current = observer;
      }
    }

    const tipEl = tipRef.current;
    const tip = {
      width: tipEl?.offsetWidth ?? TOOLTIP_W,
      height: tipEl?.offsetHeight ?? 140,
    };
    setTipPos(placeTooltip(measured?.rect ?? null, tip, step.preferredSide));
  }, [step]);

  // Prepare the host UI, then observe actual DOM/layout readiness.
  useEffect(() => {
    missingPassesRef.current = 0;
    requestedExampleRef.current = false;
    measuredElementRef.current = null;
    stepChangeRef.current?.(step);
    prepareStepRef.current?.(step);

    const scheduleMeasurement = () => {
      if (scheduledFrameRef.current !== null) return;
      scheduledFrameRef.current = requestAnimationFrame(() => {
        scheduledFrameRef.current = null;
        remeasure();
      });
    };
    scheduleMeasurementRef.current = scheduleMeasurement;

    const mutationObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((mutations) => {
            const overlay = document.querySelector(
              '[data-testid="onboarding-tour"]',
            );
            if (
              mutations.some(
                (mutation) =>
                  !overlay || !overlay.contains(mutation.target as Node),
              )
            ) {
              scheduleMeasurement();
            }
          });
    mutationObserver?.observe(document.body, {
      attributes: true,
      childList: true,
      subtree: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"],
    });
    window.addEventListener("resize", scheduleMeasurement);
    window.addEventListener("scroll", scheduleMeasurement, true);
    scheduleMeasurement();

    return () => {
      if (scheduledFrameRef.current !== null) {
        cancelAnimationFrame(scheduledFrameRef.current);
        scheduledFrameRef.current = null;
      }
      mutationObserver?.disconnect();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      measuredElementRef.current = null;
      window.removeEventListener("resize", scheduleMeasurement);
      window.removeEventListener("scroll", scheduleMeasurement, true);
      stepChangeRef.current?.(null);
    };
  }, [step, remeasure]);

  // Focus trap inside the tooltip; initial focus on Next.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !tipRef.current) return;
      const focusable = tipRef.current.querySelectorAll<HTMLElement>(
        'button, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    nextRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [index]);

  const goNext = () => {
    if (isLast) onClose("complete");
    else setIndex((i) => i + 1);
  };

  const transition =
    "transition-[top,left,width,height] duration-300 ease-out motion-reduce:transition-none";

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label={`Tempo tutorial, step ${index + 1} of ${TOUR_STEPS.length}: ${step.title}`}
      data-testid="onboarding-tour"
    >
      {/* Dimmed overlay with a cutout around the spotlight target, built
          from four rectangles so the target stays visible underneath. */}
      {spot ? (
        <>
          <div
            className={cn(
              "bg-background/70 pointer-events-auto absolute",
              transition,
            )}
            style={{ top: 0, left: 0, right: 0, height: Math.max(spot.top, 0) }}
          />
          <div
            className={cn(
              "bg-background/70 pointer-events-auto absolute",
              transition,
            )}
            style={{
              top: spot.top + spot.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <div
            className={cn(
              "bg-background/70 pointer-events-auto absolute",
              transition,
            )}
            style={{
              top: spot.top,
              left: 0,
              width: Math.max(spot.left, 0),
              height: spot.height,
            }}
          />
          <div
            className={cn(
              "bg-background/70 pointer-events-auto absolute",
              transition,
            )}
            style={{
              top: spot.top,
              left: spot.left + spot.width,
              right: 0,
              height: spot.height,
            }}
          />
          <div
            aria-hidden="true"
            data-testid="onboarding-spotlight"
            className={cn(
              "ring-ring pointer-events-none absolute rounded-md ring-2",
              transition,
            )}
            style={{
              top: spot.top,
              left: spot.left,
              width: spot.width,
              height: spot.height,
            }}
          />
        </>
      ) : (
        <div className="bg-background/70 pointer-events-auto absolute inset-0" />
      )}

      {/* Tooltip card */}
      <div
        ref={tipRef}
        className={cn(
          "bg-popover text-popover-foreground pointer-events-auto absolute rounded-md border p-4 shadow-sm",
          transition,
        )}
        style={{ top: tipPos.top, left: tipPos.left, width: TOOLTIP_W }}
      >
        <p className="label-mono text-muted-foreground">
          {index + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="text-foreground mt-1.5 text-sm font-semibold">
          {step.title}
        </h2>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          {step.body}
        </p>
        <div className="mt-3.5 flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => onClose("skip-all")}
            aria-label="Skip tutorial and don't show it again"
            title="Don't show the tutorial automatically again"
          >
            Skip all
          </Button>
          <Button
            ref={nextRef}
            size="sm"
            className="ml-auto"
            onClick={goNext}
            aria-label={isLast ? "Finish tutorial" : "Next tutorial step"}
          >
            {isLast ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
