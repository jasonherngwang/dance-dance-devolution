import { useEffect, useState } from 'react';
import type { HypeLevel } from './ComboDisplay';

// ---------------------------------------------------------------------------
// Border glow styles per hype level (inset box-shadow on full-screen overlay)
// ---------------------------------------------------------------------------

const BORDER_GLOW: Record<HypeLevel, string> = {
  0: 'none',
  1: 'none',
  2: 'inset 0 0 55px 12px rgba(255, 102, 0, 0.30), inset 0 0 25px 4px rgba(255, 60, 0, 0.20)',
  3: 'inset 0 0 100px 25px rgba(255, 0, 204, 0.45), inset 0 0 50px 10px rgba(255, 0, 102, 0.32)',
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
  /**
   * Called on mount with a no-arg function the parent calls to
   * trigger a brief chromatic-aberration flash (e.g., at combo milestones).
   */
  onRegisterChromatic: (fn: () => void) => void;
}

// ---------------------------------------------------------------------------
// HypeOverlay
// ---------------------------------------------------------------------------

/**
 * Full-viewport HTML overlay that provides screen-level hype effects:
 *
 * - Inset border glow: activates at 25+ combo (orange), intensifies at 50+ (magenta).
 *   Pulses at level 3.
 * - Chromatic-aberration flash: brief red/blue split-color edge halos triggered
 *   when the combo hits milestones (25, 50, 100).
 */
export function HypeOverlay({ onRegisterUpdate, onRegisterChromatic }: Props) {
  const [hypeLevel, setHypeLevel] = useState<HypeLevel>(0);
  // Increment to remount the flash element and replay its CSS animation
  const [chromaticKey, setChromaticKey] = useState(0);

  useEffect(() => {
    onRegisterUpdate((combo: number, isBreak: boolean) => {
      if (isBreak) {
        setHypeLevel(0);
      } else {
        if (combo >= 50) setHypeLevel(3);
        else if (combo >= 25) setHypeLevel(2);
        else if (combo >= 10) setHypeLevel(1);
        else setHypeLevel(0);
      }
    });

    onRegisterChromatic(() => {
      setChromaticKey(k => k + 1);
    });
  }, [onRegisterUpdate, onRegisterChromatic]);

  const showBorder = hypeLevel >= 2;

  return (
    <>
      {/* Screen border glow — activates at level 2 (25+ combo) */}
      <div
        className={hypeLevel === 3 ? 'hype-border hype-border--level3' : 'hype-border'}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 5,
          boxShadow: showBorder ? BORDER_GLOW[hypeLevel] : 'none',
          transition: 'box-shadow 0.6s ease',
        }}
      />

      {/* Chromatic-aberration flash — triggered on combo milestones.
          Re-keyed each time so the CSS animation replays from scratch. */}
      {chromaticKey > 0 && (
        <div
          key={chromaticKey}
          className="chromatic-flash"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 6,
          }}
        />
      )}
    </>
  );
}
