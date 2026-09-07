import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export interface OnboardingToastProps {
  title: string;
  body: string;
  /** Total visible time before onDone fires. */
  durationMs?: number;
  onDone: () => void;
}

/**
 * Small auto-dismissing toast (e.g. after tutorial completion). Fades in,
 * holds, fades out, then calls onDone. Non-interactive; role="status" so
 * screen readers announce it politely.
 */
export function OnboardingToast({
  title,
  body,
  durationMs = 2000,
  onDone,
}: OnboardingToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const enter = requestAnimationFrame(() => setVisible(true));
    const exitTimer = window.setTimeout(() => setVisible(false), durationMs);
    const doneTimer = window.setTimeout(onDone, durationMs + 200);
    return () => {
      cancelAnimationFrame(enter);
      window.clearTimeout(exitTimer);
      window.clearTimeout(doneTimer);
    };
  }, [durationMs, onDone]);

  return (
    <div
      role="status"
      className={cn(
        "bg-popover text-popover-foreground pointer-events-none fixed bottom-6 left-1/2 z-[80] w-72 -translate-x-1/2 rounded-md border p-3.5 shadow-sm transition-opacity duration-200 motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
        {body}
      </p>
    </div>
  );
}
