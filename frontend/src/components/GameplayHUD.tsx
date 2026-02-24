import { useEffect, useRef } from 'react';

interface GameplayHUDProps {
  onRegisterUpdate: (fn: (score: number, progress: number) => void) => void;
}

const LIFE_SEGMENTS = 24;

export function GameplayHUD({ onRegisterUpdate }: GameplayHUDProps) {
  const scoreRef   = useRef<HTMLSpanElement>(null);
  const barFillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onRegisterUpdate((score: number, progress: number) => {
      if (scoreRef.current) {
        scoreRef.current.textContent = String(Math.floor(score)).padStart(9, '0');
      }
      if (barFillRef.current) {
        barFillRef.current.style.width = `${(Math.min(Math.max(progress, 0), 1) * 100).toFixed(2)}%`;
      }
    });
  }, [onRegisterUpdate]);

  return (
    <>
      {/* DDR Chrome Life Bar — top of screen */}
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none select-none"
        style={{ zIndex: 10 }}
      >
        {/* Outer chrome/metallic frame */}
        <div
          style={{
            background: 'linear-gradient(180deg, #e0e0e0 0%, #c8c8c8 8%, #888888 42%, #555555 58%, #909090 92%, #d0d0d0 100%)',
            padding: '3px 8px 4px 8px',
            boxShadow: '0 3px 12px rgba(0,0,0,0.9), inset 0 1px 1px rgba(255,255,255,0.4)',
          }}
        >
          <div className="flex items-center gap-2">
            {/* LIFE label */}
            <div
              style={{
                fontSize: '0.55rem',
                color: '#00eeff',
                letterSpacing: '0.18em',
                fontFamily: "'Press Start 2P', monospace",
                textShadow: '0 0 8px #0088ff',
                flexShrink: 0,
              }}
            >
              LIFE
            </div>

            {/* Inner dark bezel + bar */}
            <div
              style={{
                flex: 1,
                background: 'linear-gradient(180deg, #111111 0%, #000000 100%)',
                padding: '2px',
                boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.95), inset 0 -1px 2px rgba(255,255,255,0.04)',
              }}
            >
              <div
                style={{
                  height: 24,
                  background: '#000010',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Gradient fill — vibrant DDR rainbow */}
                <div
                  ref={barFillRef}
                  style={{
                    height: '100%',
                    width: '0%',
                    background: 'linear-gradient(90deg, #ff0011 0%, #ff4400 18%, #ff8800 38%, #ffdd00 60%, #aaff00 78%, #00ff44 100%)',
                    transition: 'width 0.12s linear',
                    position: 'relative',
                  }}
                >
                  {/* Top sheen highlight */}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.50) 0%, rgba(255,255,255,0.10) 40%, transparent 100%)',
                      pointerEvents: 'none',
                    }}
                  />
                </div>

                {/* Segment dividers */}
                {Array.from({ length: LIFE_SEGMENTS - 1 }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${((i + 1) / LIFE_SEGMENTS) * 100}%`,
                      width: 2,
                      background: 'rgba(0,0,0,0.75)',
                      pointerEvents: 'none',
                      zIndex: 2,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Score — bottom-center, LED readout style */}
      <div
        className="absolute pointer-events-none select-none"
        style={{ bottom: 0, left: 0, right: 0, display: 'flex', justifyContent: 'center', zIndex: 10 }}
      >
        <div
          className="led-display chrome-frame"
          style={{
            padding: '8px 28px 10px 28px',
            display: 'inline-flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: '0.5rem',
              letterSpacing: '0.3em',
              color: 'rgba(0,238,255,0.65)',
              marginBottom: 3,
            }}
          >
            SCORE
          </div>
          <div
            style={{
              fontFamily: "'VT323', 'Courier New', monospace",
              fontSize: '2.8rem',
              color: '#00ff55',
              letterSpacing: '0.06em',
              lineHeight: 1,
              textShadow: '0 0 14px rgba(0,255,80,0.9), 0 0 32px rgba(0,255,60,0.4)',
            }}
          >
            <span ref={scoreRef}>000000000</span>
          </div>
        </div>
      </div>
    </>
  );
}
