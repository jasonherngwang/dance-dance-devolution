import { useEffect, useRef } from 'react';

interface ScreenEffectsProps {
  /** Called with a function that triggers a brief white flash (on Perfect hits). */
  onRegisterFlash: (fn: () => void) => void;
}

/**
 * CSS-driven screen effects:
 * - Permanent vignette: radial gradient that darkens the edges
 * - Screen flash: brief white overlay triggered on Perfect judgments
 *
 * Chromatic aberration is handled by HypeOverlay (Issue 13).
 */
export function ScreenEffects({ onRegisterFlash }: ScreenEffectsProps) {
  const flashRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onRegisterFlash(() => {
      const el = flashRef.current;
      if (!el) return;
      // Cancel any in-progress flash
      if (timerRef.current) clearTimeout(timerRef.current);
      // Show at 10% opacity — brief, subtle
      el.style.opacity = '0.1';
      el.style.transition = 'none';
      // Fade out over ~80ms (~5 frames) after a 2-frame hold (~33ms)
      timerRef.current = setTimeout(() => {
        if (flashRef.current) {
          flashRef.current.style.transition = 'opacity 80ms ease-out';
          flashRef.current.style.opacity = '0';
        }
      }, 33);
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onRegisterFlash]);

  return (
    <>
      {/* Permanent vignette — draws focus to the play field */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.72) 100%)',
          zIndex: 0,
        }}
      />
      {/* Screen flash — white overlay, starts hidden, triggered on Perfect */}
      <div
        ref={flashRef}
        className="pointer-events-none absolute inset-0 bg-white"
        style={{ opacity: 0, zIndex: 1 }}
      />
    </>
  );
}
