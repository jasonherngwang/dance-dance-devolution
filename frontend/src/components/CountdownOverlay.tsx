import { useCallback, useEffect, useRef } from 'react';

/**
 * Countdown phase values:
 *   3 / 2 / 1  → show the corresponding number
 *   0          → show "GO!"
 *  -1          → hide overlay
 */
export type CountdownPhase = -1 | 0 | 1 | 2 | 3;

interface CountdownOverlayProps {
  /** GameCanvas calls this to register the imperative update function. */
  onRegisterUpdate: (fn: (phase: CountdownPhase) => void) => void;
  /** Only rendered in real-game mode (not demo). */
  isActive: boolean;
}

// Per-phase colors (neon palette)
const PHASE_COLOR: Record<number, string> = {
  3: '#00ffff',  // cyan
  2: '#00ffff',  // cyan
  1: '#ff8800',  // orange
  0: '#00ff88',  // green  (GO!)
};

/**
 * Full-screen countdown overlay that renders "3 → 2 → 1 → GO!" before
 * gameplay begins.  All DOM mutations are performed imperatively so that
 * React does not need to re-render the entire GameCanvas tree on each phase
 * change.  The overlay is driven from the GameCanvas animation loop via the
 * `onRegisterUpdate` callback.
 */
export function CountdownOverlay({ onRegisterUpdate, isActive }: CountdownOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const lastPhaseRef = useRef<CountdownPhase>(-1);

  const updatePhase = useCallback((phase: CountdownPhase) => {
    if (phase === lastPhaseRef.current) return;
    lastPhaseRef.current = phase;

    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    if (phase === -1) {
      // Hide the overlay
      container.style.opacity = '0';
      return;
    }

    // Show the overlay
    container.style.opacity = '1';

    const label = phase === 0 ? 'GO!' : String(phase);
    const color = PHASE_COLOR[phase] ?? '#ffffff';

    text.textContent = label;
    text.style.color = color;
    text.style.textShadow = [
      `0 0 20px ${color}`,
      `0 0 50px ${color}`,
      `0 0 100px ${color}`,
      `0 2px 6px rgba(0,0,0,0.9)`,
    ].join(', ');

    // Swap CSS animation class to restart it (force reflow in between)
    const animClass = phase === 0 ? 'countdown-go' : 'countdown-number';
    text.className = '';
    // Force layout so removing the class takes effect before we add it back
    void text.offsetWidth;
    text.className = animClass;
  }, []);

  useEffect(() => {
    onRegisterUpdate(updatePhase);
  }, [onRegisterUpdate, updatePhase]);

  if (!isActive) return null;

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
      style={{ opacity: 0 }}
    >
      {/* Subtle dark radial backdrop so the number pops over busy backgrounds */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 40% 30% at 50% 50%, rgba(0,0,0,0.45) 0%, transparent 100%)',
        }}
      />
      <span
        ref={textRef}
        className="countdown-number"
        style={{
          position: 'relative',
          fontSize: 'clamp(5rem, 18vw, 10rem)',
          fontWeight: 900,
          letterSpacing: '-0.02em',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          lineHeight: 1,
          willChange: 'transform, opacity',
        }}
      />
    </div>
  );
}
