import { useEffect, useRef, useState } from "react";

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
// Per-level styling — DDR-authentic color escalation
// ---------------------------------------------------------------------------

const HYPE_COLOR: Record<HypeLevel, string> = {
  0: "#ffffff",
  1: "#ffdd00", // gold at 10+
  2: "#ff8800", // orange at 25+
  3: "#ff44ff", // magenta/pink at 50+
};

const HYPE_GLOW: Record<HypeLevel, string> = {
  0: "0 0 10px #fff, 1px 1px 0 #333",
  1: "0 0 16px #ffdd00, 0 0 38px #ffaa00, 1px 1px 0 #664400",
  2: "0 0 24px #ff8800, 0 0 54px #ff6600, 1px 1px 0 #662200",
  3: "0 0 36px #ff44ff, 0 0 80px #cc00cc, 0 0 140px #ff00ff, 2px 2px 0 #550055",
};

const HYPE_FONT_SIZE: Record<HypeLevel, string> = {
  0: "3.0rem",
  1: "3.6rem",
  2: "4.5rem",
  3: "5.8rem",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  onRegisterUpdate: (fn: (combo: number, isBreak: boolean) => void) => void;
}

// ---------------------------------------------------------------------------
// ComboDisplay
// ---------------------------------------------------------------------------

export function ComboDisplay({ onRegisterUpdate }: Props) {
  const [displayCombo, setDisplayCombo] = useState(0);
  const [hypeLevel, setHypeLevel] = useState<HypeLevel>(0);
  const [pulseKey, setPulseKey] = useState(0);
  const [isBreaking, setIsBreaking] = useState(false);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    onRegisterUpdate((newCombo: number, isBreak: boolean) => {
      if (isBreak) {
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
          setPulseKey((k) => k + 1);
        }
      }
    });

    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
    };
  }, [onRegisterUpdate]);

  if (displayCombo < 2 && !isBreaking) return null;

  const color = isBreaking ? "#ff3333" : HYPE_COLOR[hypeLevel];
  const glow = isBreaking
    ? "0 0 16px #ff3333, 0 0 40px #ff0000, 1px 1px 0 #660000"
    : HYPE_GLOW[hypeLevel];
  const fontSize = HYPE_FONT_SIZE[isBreaking ? 0 : hypeLevel];

  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        style={{
          position: "absolute",
          right: "12%",
          top: "30%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Radial aura at hype level 1+ */}
        {hypeLevel >= 1 && !isBreaking && (
          <div
            className="combo-aura"
            style={{
              position: "absolute",
              inset: "-40px",
              borderRadius: "50%",
              background: `radial-gradient(ellipse at center, ${HYPE_COLOR[hypeLevel]}35 0%, transparent 70%)`,
              animationDuration:
                hypeLevel >= 3 ? "0.15s" : hypeLevel >= 2 ? "0.30s" : "0.50s",
            }}
          />
        )}

        {/* Combo number */}
        <div
          key={pulseKey}
          className={
            isBreaking
              ? "combo-number combo-number--break"
              : "combo-number combo-number--hit"
          }
          style={{
            fontSize,
            fontWeight: 800, // bolder font for better outline
            color,
            textShadow: glow,
            WebkitTextStroke: "2px #000", // strong black outline
            lineHeight: 1,
            fontFamily: "'Press Start 2P', 'Courier New', monospace",
            letterSpacing: "0",
            position: "relative",
            zIndex: 1,
          }}
        >
          {displayCombo}
        </div>

        {/* "COMBO" label */}
        <div
          style={{
            fontFamily: "'Bungee', 'Impact', sans-serif",
            fontSize: "0.85rem",
            color,
            letterSpacing: "0.25em",
            opacity: isBreaking ? 0.4 : 0.9,
            textShadow: `0 0 8px ${color}`,
            marginTop: 4,
            position: "relative",
            zIndex: 1,
          }}
        >
          COMBO
        </div>

        {/* "HYPE!" pulsing indicator at level 3 */}
        {hypeLevel >= 3 && !isBreaking && (
          <div
            className="hype-text"
            style={{
              fontFamily: "'Bungee', 'Impact', sans-serif",
              fontSize: "0.95rem",
              color: "#ff44ff",
              letterSpacing: "0.24em",
              textShadow:
                "0 0 16px #ff44ff, 0 0 38px #cc00cc, 0 0 70px #ff00ff",
              marginTop: 6,
              position: "relative",
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
