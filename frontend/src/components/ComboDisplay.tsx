import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Hype level thresholds
// ---------------------------------------------------------------------------

export type HypeLevel = 0 | 1 | 2 | 3;

export function getHypeLevel(combo: number): HypeLevel {
  if (combo >= 50) return 3;
  if (combo >= 25) return 2;
  if (combo >= 10) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Per-level styling constants
// ---------------------------------------------------------------------------

const HYPE_COLOR: Record<HypeLevel, string> = {
  0: '#ffffff',
  1: '#ffcc00',  // golden at 10+
  2: '#ff8800',  // orange at 25+
  3: '#ff00ff',  // magenta at 50+
};

const HYPE_GLOW: Record<HypeLevel, string> = {
  0: '0 0 8px #fff, 0 0 18px #fff',
  1: '0 0 12px #ffcc00, 0 0 28px #ffcc00, 0 0 55px #ffaa00',
  2: '0 0 16px #ff8800, 0 0 40px #ff8800, 0 0 80px #ff6600',
  3: '0 0 20px #ff00ff, 0 0 50px #ff00ff, 0 0 100px #cc00ff, 0 0 160px #ff00ff',
};

// Font size in rem grows with hype level
const HYPE_FONT_SIZE: Record<HypeLevel, string> = {
  0: '2.5rem',
  1: '2.9rem',
  2: '3.3rem',
  3: '3.8rem',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /**
   * Called on mount with a trigger function the parent stores in a ref.
   * The parent calls this with (combo, isBreak) whenever the combo changes.
   * isBreak=true means a miss just happened (plays break animation, then hides).
   */
  onRegisterUpdate: (fn: (combo: number, isBreak: boolean) => void) => void;
}

// ---------------------------------------------------------------------------
// ComboDisplay
// ---------------------------------------------------------------------------

/**
 * HTML overlay that renders the escalating combo counter.
 *
 * Hype levels:
 *   0  (0–9)   – hidden below 2, plain white at 2+
 *   1  (10–24) – golden glow + radial aura
 *   2  (25–49) – orange glow + stronger aura
 *   3  (50+)   – magenta full-hype + pulsing "HYPE!" label
 *
 * On combo break: red flash + shrink, then hides after 500ms.
 */
export function ComboDisplay({ onRegisterUpdate }: Props) {
  // displayCombo is kept at the pre-break value during the break animation
  const [displayCombo, setDisplayCombo] = useState(0);
  const [hypeLevel, setHypeLevel] = useState<HypeLevel>(0);
  // Increment to force a CSS animation restart on each new combo hit
  const [pulseKey, setPulseKey] = useState(0);
  const [isBreaking, setIsBreaking] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    onRegisterUpdate((newCombo: number, isBreak: boolean) => {
      if (isBreak) {
        // Keep the current displayed value visible during the break animation,
        // then hide after 500ms (by setting displayCombo to 0).
        setIsBreaking(true);
        const t = setTimeout(() => {
          setDisplayCombo(0);
          setHypeLevel(0);
          setIsBreaking(false);
        }, 500);
        timeoutsRef.current.push(t);
      } else {
        setDisplayCombo(newCombo);
        setHypeLevel(getHypeLevel(newCombo));
        if (newCombo > 0) {
          // Re-key the number element so its CSS animation replays
          setPulseKey(k => k + 1);
        }
      }
    });

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [onRegisterUpdate]);

  // Hide below 2 (but keep visible during break animation even if combo=0)
  if (displayCombo < 2 && !isBreaking) return null;

  const color = isBreaking ? '#ff4444' : HYPE_COLOR[hypeLevel];
  const glow  = isBreaking ? '0 0 15px #ff4444, 0 0 40px #ff4444' : HYPE_GLOW[hypeLevel];
  const fontSize = HYPE_FONT_SIZE[isBreaking ? 0 : hypeLevel];

  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Centered combo block, positioned in lower-center area */}
      <div
        style={{
          position: 'absolute',
          bottom: '28%',
          left: '50%',
          transform: 'translateX(-50%)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Radial aura at hype level 1+ */}
        {hypeLevel >= 1 && !isBreaking && (
          <div
            className="combo-aura"
            style={{
              position: 'absolute',
              inset: '-35px',
              borderRadius: '50%',
              background: `radial-gradient(ellipse at center, ${HYPE_COLOR[hypeLevel]}30 0%, transparent 70%)`,
              animationDuration:
                hypeLevel >= 3 ? '0.35s' : hypeLevel >= 2 ? '0.55s' : '0.75s',
            }}
          />
        )}

        {/* Combo number — re-keyed on each hit so the pulse animation replays */}
        <div
          key={pulseKey}
          className={isBreaking ? 'combo-number combo-number--break' : 'combo-number combo-number--hit'}
          style={{
            fontSize,
            fontWeight: 900,
            color,
            textShadow: glow,
            lineHeight: 1,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            letterSpacing: '-0.02em',
            position: 'relative',
            zIndex: 1,
            transition: 'font-size 0.25s ease, color 0.3s ease',
          }}
        >
          {displayCombo}
        </div>

        {/* "COMBO" label */}
        <div
          style={{
            fontSize: '0.62rem',
            fontWeight: 700,
            color,
            letterSpacing: '0.38em',
            opacity: isBreaking ? 0.35 : 0.85,
            textShadow: `0 0 8px ${color}`,
            marginTop: '3px',
            position: 'relative',
            zIndex: 1,
            transition: 'color 0.3s ease, opacity 0.3s ease',
          }}
        >
          COMBO
        </div>

        {/* "HYPE!" pulsing indicator at level 3 */}
        {hypeLevel >= 3 && !isBreaking && (
          <div
            className="hype-text"
            style={{
              fontSize: '0.8rem',
              fontWeight: 900,
              color: '#ff00ff',
              letterSpacing: '0.28em',
              textShadow: '0 0 15px #ff00ff, 0 0 35px #ff00ff, 0 0 65px #ff00ff',
              marginTop: '5px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            HYPE!
          </div>
        )}
      </div>
    </div>
  );
}
