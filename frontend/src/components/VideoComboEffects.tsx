import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Level = 0 | 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Corner config
// ---------------------------------------------------------------------------

const CORNER_ANCHOR: Record<'tl' | 'tr' | 'bl' | 'br', React.CSSProperties> = {
  tl: { top: 0, left: 0 },
  tr: { top: 0, right: 0 },
  bl: { bottom: 0, left: 0 },
  br: { bottom: 0, right: 0 },
};

const CORNER_GRAD_POS: Record<'tl' | 'tr' | 'bl' | 'br', string> = {
  tl: '0% 0%',
  tr: '100% 0%',
  bl: '0% 100%',
  br: '100% 100%',
};

// Each level has a different color theme for the corners
const CORNER_COLOR: Record<Level, string> = {
  0: 'transparent',
  1: 'rgba(0, 200, 255, 0.30)',    // cool cyan
  2: 'rgba(255, 120, 0, 0.32)',    // hot orange
  3: 'rgba(255, 0, 200, 0.36)',    // extreme magenta
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /**
   * Called on mount with a function the parent stores in a ref.
   * Parent calls it with (combo, isBreak) whenever combo changes.
   */
  onRegisterUpdate: (fn: (combo: number, isBreak: boolean) => void) => void;
}

// ---------------------------------------------------------------------------
// VideoComboEffects
// ---------------------------------------------------------------------------

/**
 * CSS-driven video overlay effects that escalate with the player's combo.
 * Designed for YouTube video background games — sits above the Three.js canvas
 * (pointer-events: none) and adds:
 *
 * - CRT scanlines: always faintly visible, scroll faster at high combo
 * - Color tint: cool blue → warm orange → cycling magenta as combo rises
 * - Corner light flares: four radial beams shooting from screen corners
 * - Horizontal scan beam: sweeping light band at level 3 (50+ combo)
 * - Center bloom: pulsing radial glow at level 3
 * - Combo break flash: brief red overlay when combo drops
 *
 * Level thresholds match the rest of the game: 10 / 25 / 50.
 */
export function VideoComboEffects({ onRegisterUpdate }: Props) {
  const [level, setLevel] = useState<Level>(0);
  const [breakKey, setBreakKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onRegisterUpdate((combo: number, isBreak: boolean) => {
      if (isBreak) {
        // Immediately flash; drop to level 0 after a short delay so the
        // break flash covers the abrupt transition.
        setBreakKey(k => k + 1);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setLevel(0), 360);
      } else {
        if (timerRef.current) clearTimeout(timerRef.current);
        const newLevel: Level =
          combo >= 50 ? 3 : combo >= 25 ? 2 : combo >= 10 ? 1 : 0;
        setLevel(newLevel);
      }
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onRegisterUpdate]);

  // Scanlines: always present at low opacity; scroll at levels 2-3.
  const scanOpacity    = [0.18, 0.32, 0.52, 0.68][level];
  const scanAnimSpeed  = level >= 3 ? '0.65s' : '2.0s';
  const scanAnimState  = level >= 2 ? 'running' : 'paused';

  // Color tint per level
  const tintBg =
    level === 1 ? 'linear-gradient(135deg, rgba(40,0,160,0.13) 0%, rgba(0,20,100,0.09) 100%)' :
    level === 2 ? 'linear-gradient(135deg, rgba(255,60,0,0.10) 0%, rgba(180,0,80,0.09) 100%)' :
    /* level 3 */ 'rgba(255, 0, 180, 0.10)';

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ zIndex: 2 }}
    >
      {/* ------------------------------------------------------------------ */}
      {/* CRT scanlines                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div
        className="vce-scanlines"
        style={{
          opacity: scanOpacity,
          animationDuration: scanAnimSpeed,
          animationPlayState: scanAnimState,
          transition: 'opacity 0.65s ease',
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Color tint                                                           */}
      {/* ------------------------------------------------------------------ */}
      <div
        className={level >= 3 ? 'vce-tint vce-tint--hyped' : 'vce-tint'}
        style={{
          opacity: level === 0 ? 0 : 1,
          background: tintBg,
          transition: 'opacity 0.65s ease',
        }}
      />

      {/* ------------------------------------------------------------------ */}
      {/* Corner light flares (4 corners)                                     */}
      {/* ------------------------------------------------------------------ */}
      {(['tl', 'tr', 'bl', 'br'] as const).map(pos => (
        <div
          key={pos}
          className={level >= 3 ? 'vce-corner vce-corner--hyped' : 'vce-corner'}
          style={{
            ...CORNER_ANCHOR[pos],
            background:
              level === 0
                ? 'transparent'
                : `radial-gradient(ellipse 110% 110% at ${CORNER_GRAD_POS[pos]}, ${CORNER_COLOR[level]} 0%, transparent 62%)`,
            opacity: [0, 0.60, 0.80, 1.0][level],
            transition: 'opacity 0.65s ease',
          }}
        />
      ))}

      {/* ------------------------------------------------------------------ */}
      {/* Horizontal scan beam — level 3 only                                 */}
      {/* ------------------------------------------------------------------ */}
      {level >= 3 && <div className="vce-scan-beam" />}

      {/* ------------------------------------------------------------------ */}
      {/* Center bloom — level 3 only                                         */}
      {/* ------------------------------------------------------------------ */}
      {level >= 3 && <div className="vce-center-bloom" />}

      {/* ------------------------------------------------------------------ */}
      {/* Combo break flash — re-keyed on each break to replay animation      */}
      {/* ------------------------------------------------------------------ */}
      {breakKey > 0 && <div key={breakKey} className="vce-break-flash" />}
    </div>
  );
}
