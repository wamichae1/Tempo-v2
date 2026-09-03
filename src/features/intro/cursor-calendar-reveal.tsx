import { useEffect, useRef } from "react";

export interface CursorCalendarRevealProps {
  /** Always-visible base image (monochrome calendar). */
  ghostSrc: string;
  /** Full-color image stacked directly above the base. */
  revealSrc: string;
  /** Reveal radius in px. */
  radius?: number;
  className?: string;
}

/**
 * Two identically-sized images stacked perfectly; the colored layer is
 * revealed through a feathered radial mask that smoothly follows the
 * pointer (lerped via requestAnimationFrame). Respects reduced motion.
 */
export function CursorCalendarReveal({
  ghostSrc,
  revealSrc,
  radius = 220,
  className,
}: CursorCalendarRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const reveal = revealRef.current;
    if (!container || !reveal) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let opacity = 0;
    let targetOpacity = 0;
    let active = false;
    let rafId: number | null = null;

    const apply = () => {
      const mask = `radial-gradient(circle ${radius}px at ${currentX}px ${currentY}px, #000 0%, #000 55%, transparent 100%)`;
      reveal.style.webkitMaskImage = mask;
      reveal.style.maskImage = mask;
      reveal.style.opacity = String(opacity);
    };

    const tick = () => {
      // Exponential smoothing toward the pointer; ease opacity in/out.
      currentX += (targetX - currentX) * 0.18;
      currentY += (targetY - currentY) * 0.18;
      opacity += (targetOpacity - opacity) * 0.12;
      apply();

      const settled =
        Math.abs(targetX - currentX) < 0.2 &&
        Math.abs(targetY - currentY) < 0.2 &&
        Math.abs(targetOpacity - opacity) < 0.005;
      if (settled) {
        currentX = targetX;
        currentY = targetY;
        opacity = targetOpacity;
        apply();
        rafId = null;
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    const schedule = () => {
      if (rafId === null) rafId = requestAnimationFrame(tick);
    };

    const setTargetFromEvent = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      targetX = e.clientX - rect.left;
      targetY = e.clientY - rect.top;
    };

    const onEnter = (e: PointerEvent) => {
      setTargetFromEvent(e);
      if (!active) {
        active = true;
        // Start the lerp from the entry point so the reveal blooms in place
        // instead of sweeping across from a stale position.
        currentX = targetX;
        currentY = targetY;
      }
      targetOpacity = 1;
      if (reduced) {
        opacity = 1;
        currentX = targetX;
        currentY = targetY;
        apply();
      } else {
        schedule();
      }
    };

    const onMove = (e: PointerEvent) => {
      setTargetFromEvent(e);
      if (reduced) {
        currentX = targetX;
        currentY = targetY;
        apply();
      } else {
        schedule();
      }
    };

    const onLeave = () => {
      active = false;
      targetOpacity = 0;
      if (reduced) {
        opacity = 0;
        apply();
      } else {
        schedule();
      }
    };

    container.addEventListener("pointerenter", onEnter);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerdown", onEnter);
    container.addEventListener("pointerleave", onLeave);
    container.addEventListener("pointercancel", onLeave);
    return () => {
      container.removeEventListener("pointerenter", onEnter);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerdown", onEnter);
      container.removeEventListener("pointerleave", onLeave);
      container.removeEventListener("pointercancel", onLeave);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [radius]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", touchAction: "pan-y" }}
    >
      <img
        src={ghostSrc}
        alt=""
        draggable={false}
        className="block h-auto w-full select-none"
      />
      <img
        ref={revealRef}
        src={revealSrc}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pointer-events-none absolute inset-0 block h-full w-full select-none"
        style={{ opacity: 0 }}
      />
    </div>
  );
}
