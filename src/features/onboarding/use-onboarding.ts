import { useCallback, useRef, useState } from "react";

export const LS_TUTORIAL_DONE = "tempo:tutorial-done";

export type TutorialCloseReason = "skip-all" | "complete";

function readTutorialDone(): boolean {
  try {
    return localStorage.getItem(LS_TUTORIAL_DONE) === "1";
  } catch {
    return false;
  }
}

function persistTutorialDone() {
  try {
    localStorage.setItem(LS_TUTORIAL_DONE, "1");
  } catch {
    // storage unavailable — keep in memory for this session
  }
}

/**
 * Onboarding visibility state for the Tempo Tutorial spotlight tour and the
 * WebMCP guide.
 *
 * - `skip-all` and `complete` persist `tempo:tutorial-done` so the tour never
 *   auto-starts again. Manual replays are always allowed.
 * - The WebMCP guide is manual-only; nothing is persisted for it.
 */
export function useOnboarding() {
  const [tourOpen, setTourOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(readTutorialDone);
  /** Guards against auto-starting more than once per session. */
  const autoStartedRef = useRef(false);

  const startTutorial = useCallback(() => {
    autoStartedRef.current = true;
    setTourOpen(true);
  }, []);

  /** Try to auto-start the tour (first launch, after the intro is dismissed). */
  const maybeAutoStartTutorial = useCallback(() => {
    if (autoStartedRef.current || tutorialDone || tourOpen) return;
    autoStartedRef.current = true;
    setTourOpen(true);
  }, [tutorialDone, tourOpen]);

  const closeTutorial = useCallback((reason: TutorialCloseReason) => {
    setTourOpen(false);
    if (reason === "skip-all" || reason === "complete") {
      persistTutorialDone();
      setTutorialDone(true);
    }
  }, []);

  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);

  return {
    tourOpen,
    guideOpen,
    tutorialDone,
    startTutorial,
    maybeAutoStartTutorial,
    closeTutorial,
    openGuide,
    closeGuide,
  };
}
