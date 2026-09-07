import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CursorCalendarReveal } from "@/features/intro/cursor-calendar-reveal";

export interface IntroOverlayProps {
  onDismiss: () => void;
  onStartTutorial?: () => void;
  onOpenWebMcpGuide?: () => void;
}

/** Base-aware public asset URL (respects Vite `base` for GitHub Pages). */
const asset = (path: string) => `${import.meta.env.BASE_URL}${path}`;

/**
 * First-launch welcome surface. Full-screen glass over the workspace with
 * the Tempo wordmark, short orientation copy, and an interactive calendar
 * reveal. Dismisses via Continue or Escape; purely presentational — the
 * calendar workspace underneath is untouched. Mounted conditionally by the
 * parent; plays a short exit fade before calling onDismiss.
 */
export function IntroOverlay({
  onDismiss,
  onStartTutorial,
  onOpenWebMcpGuide,
}: IntroOverlayProps) {
  const [entered, setEntered] = useState(false);
  const [closing, setClosing] = useState(false);
  const continueRef = useRef<HTMLButtonElement>(null);
  const dismissTimer = useRef<number | null>(null);

  // Fade out, then let the parent unmount us.
  const requestDismiss = () => {
    if (closing) return;
    setClosing(true);
    dismissTimer.current = window.setTimeout(onDismiss, 200);
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => {
      cancelAnimationFrame(id);
      if (dismissTimer.current !== null)
        window.clearTimeout(dismissTimer.current);
    };
  }, []);

  // Escape to dismiss; initial focus on Continue. Scoped to while-mounted.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        requestDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    continueRef.current?.focus();
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  // Lock body scroll while the overlay is up.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-title"
      className={`fixed inset-0 z-50 overflow-y-auto transition-opacity duration-200 motion-reduce:transition-none ${
        entered && !closing ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Glass surface over the workspace */}
      <div className="bg-background/70 absolute inset-0 backdrop-blur-xl" />

      <div className="relative flex min-h-full items-center justify-center p-6 sm:p-10">
        <div className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-14">
          {/* Left: identity + copy */}
          <div className="max-w-md">
            <img
              src={asset("intro/LogoB.svg")}
              alt="Tempo"
              className="h-18 w-auto dark:hidden"
            />
            <img
              src={asset("intro/LogoW.svg")}
              alt=""
              aria-hidden="true"
              className="hidden h-18 w-auto dark:block"
            />
            <h1
              id="intro-title"
              className="text-foreground mt-8 text-2xl font-semibold tracking-tight"
            >
              Your calendar, without the clutter.
            </h1>
            <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
              Plan your time, organize your calendars, and let the workspace
              adapt to the way you work. Edit events directly, or connect an
              external agent like ChatGPT to Tempo Agent via WebMCP.
            </p>

            <div className="mt-6 border-l pl-4">
              <p className="text-muted-foreground font-mono text-[11px] tracking-wider uppercase">
                Getting started
              </p>
              <p className="text-muted-foreground mt-1.5 font-mono text-xs leading-relaxed">
                Drag to create events. Press Ctrl+K for search. Let an agent
                schedule for you through Tempo Agent.
              </p>
            </div>

            <Button
              ref={continueRef}
              className="mt-8"
              onClick={requestDismiss}
            >
              Enter Tempo
              <ArrowRight className="size-4" />
            </Button>

            <div className="mt-8 border-t pt-6">
              <p className="text-muted-foreground font-mono text-[11px] tracking-wider uppercase">
                Get Started &amp; Guides
              </p>
              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    requestDismiss();
                    onStartTutorial?.();
                  }}
                  className="bg-secondary/50 hover:bg-secondary flex-1 rounded-md border p-3 text-left transition-colors"
                >
                  <p className="text-foreground text-xs font-semibold">
                    Learn Tempo
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                    Learn how to use the calendar and Tempo Agent.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    requestDismiss();
                    onOpenWebMcpGuide?.();
                  }}
                  className="bg-secondary/50 hover:bg-secondary flex-1 rounded-md border p-3 text-left transition-colors"
                >
                  <p className="text-foreground text-xs font-semibold">
                    Set Up WebMCP
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px] leading-snug">
                    Connect Tempo to compatible AI agents.
                  </p>
                </button>
              </div>
            </div>
          </div>

          {/* Right: interactive reveal */}
          <div className="w-full max-w-xl justify-self-center lg:max-w-none">
            <div className="overflow-hidden rounded-lg border dark:hidden">
              <CursorCalendarReveal
                ghostSrc={asset("intro/GhostCalendar.svg")}
                revealSrc={asset("intro/RevealCalendar.svg")}
              />
            </div>
            <div className="hidden overflow-hidden rounded-lg border dark:block">
              <CursorCalendarReveal
                ghostSrc={asset("intro/GhostCalendarDark.svg")}
                revealSrc={asset("intro/RevealCalendarDark.svg")}
              />
            </div>
            <p className="text-muted-foreground mt-3 text-center font-mono text-[11px] tracking-wider uppercase">
              Move your cursor over the calendar to explore
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
