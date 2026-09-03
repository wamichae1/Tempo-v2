import { useCallback, useState } from "react";

const LS_INTRO_SEEN = "tempo:intro-seen";

/**
 * First-launch intro visibility. Shown until the user dismisses it once;
 * dismissal is persisted so returning users go straight to the workspace.
 */
export function useIntro() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LS_INTRO_SEEN) !== "1";
    } catch {
      return true;
    }
  });

  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(LS_INTRO_SEEN, "1");
    } catch {
      // storage unavailable — keep in memory for this session
    }
    setOpen(false);
  }, []);

  const reopen = useCallback(() => setOpen(true), []);

  return { introOpen: open, dismissIntro: dismiss, reopenIntro: reopen };
}
