import { useEffect, useRef } from 'react';

interface GameplayHUDProps {
  /** Called once on mount to register the imperative update function */
  onRegisterUpdate: (fn: (score: number, progress: number) => void) => void;
}

/**
 * In-game HUD overlay showing:
 *   - Score (top-right)
 *   - Song progress bar (bottom edge)
 *
 * Uses the callback-ref pattern (same as ComboDisplay / JudgmentDisplay) so
 * the animation loop can update DOM nodes directly without triggering React
 * re-renders every frame.
 */
export function GameplayHUD({ onRegisterUpdate }: GameplayHUDProps) {
  const scoreRef = useRef<HTMLSpanElement>(null);
  const barRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onRegisterUpdate((score: number, progress: number) => {
      if (scoreRef.current) {
        scoreRef.current.textContent = score.toLocaleString();
      }
      if (barRef.current) {
        barRef.current.style.width = `${(Math.min(progress, 1) * 100).toFixed(2)}%`;
      }
    });
  }, [onRegisterUpdate]);

  return (
    <>
      {/* Score display — top-right corner */}
      <div className="absolute top-4 right-6 text-right pointer-events-none select-none">
        <div className="text-xs uppercase tracking-widest text-neon-cyan/60">Score</div>
        <div className="text-3xl font-mono font-bold text-white tabular-nums">
          <span ref={scoreRef}>0</span>
        </div>
      </div>

      {/* Progress bar — bottom edge of screen */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10 pointer-events-none">
        <div
          ref={barRef}
          className="h-full bg-neon-cyan"
          style={{ width: '0%' }}
        />
      </div>
    </>
  );
}
