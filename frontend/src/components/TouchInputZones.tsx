import { useEffect, useRef } from 'react';
import type { Direction } from '@/types';

// ---------------------------------------------------------------------------
// Direction layout — left to right
// ---------------------------------------------------------------------------

const DIRECTIONS: Direction[] = ['left', 'down', 'up', 'right'];

const ZONE_LABELS: Record<Direction, string> = {
  left:  '←',
  down:  '↓',
  up:    '↑',
  right: '→',
};

const ZONE_COLORS: Record<Direction, string> = {
  left:  'rgba(255, 0, 255, 0.15)',   // magenta
  down:  'rgba(0, 255, 255, 0.15)',   // cyan
  up:    'rgba(0, 255, 136, 0.15)',   // green
  right: 'rgba(255, 136, 0, 0.15)',   // orange
};

const ZONE_BORDER_COLORS: Record<Direction, string> = {
  left:  'rgba(255, 0, 255, 0.5)',
  down:  'rgba(0, 255, 255, 0.5)',
  up:    'rgba(0, 255, 136, 0.5)',
  right: 'rgba(255, 136, 0, 0.5)',
};

const ZONE_GLOW_COLORS: Record<Direction, string> = {
  left:  '#ff00ff',
  down:  '#00ffff',
  up:    '#00ff88',
  right: '#ff8800',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TouchInputZonesProps {
  onInput: (direction: Direction, timestamp: number) => void;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Four tap zones rendered at the bottom of the screen for mobile gameplay.
 *
 * - Each zone covers 25% width × 25vh height
 * - Uses `touchstart` for lowest latency (not touchend)
 * - Calls `preventDefault()` on all touch events to block scrolling and zoom
 * - Shows directional arrows with neon color coding matching the game arrows
 */
export function TouchInputZones({ onInput, enabled }: TouchInputZonesProps) {
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Track active touch zone flashes
  const zoneRefs = useRef<Record<Direction, HTMLDivElement | null>>({
    left: null, down: null, up: null, right: null,
  });

  useEffect(() => {
    const container = document.getElementById('touch-zones-container');
    if (!container) return;

    function handleTouchStart(e: TouchEvent) {
      // Always prevent default to block scrolling and double-tap zoom
      e.preventDefault();

      const containerRect = container!.getBoundingClientRect();

      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const timestamp = performance.now();

        // Determine which zone was tapped by X position within container
        const relX = touch.clientX - containerRect.left;
        const zoneWidth = containerRect.width / 4;
        const zoneIndex = Math.floor(relX / zoneWidth);
        const direction = DIRECTIONS[Math.max(0, Math.min(3, zoneIndex))];

        // Flash visual feedback regardless of game state
        const zoneEl = zoneRefs.current[direction];
        if (zoneEl) {
          zoneEl.style.backgroundColor = ZONE_COLORS[direction].replace('0.15', '0.55');
          zoneEl.style.boxShadow = `inset 0 0 20px ${ZONE_GLOW_COLORS[direction]}80`;
          setTimeout(() => {
            if (zoneEl) {
              zoneEl.style.backgroundColor = ZONE_COLORS[direction];
              zoneEl.style.boxShadow = '';
            }
          }, 120);
        }

        if (enabledRef.current) {
          onInput(direction, timestamp);
        }
      }
    }

    function handleTouchMove(e: TouchEvent) {
      e.preventDefault(); // block scroll
    }

    function handleTouchEnd(e: TouchEvent) {
      e.preventDefault(); // block double-tap zoom
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove',  handleTouchMove,  { passive: false });
    container.addEventListener('touchend',   handleTouchEnd,   { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove',  handleTouchMove);
      container.removeEventListener('touchend',   handleTouchEnd);
    };
  }, [onInput]);

  return (
    <div
      id="touch-zones-container"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '25vh',
        display: 'flex',
        zIndex: 10,
        touchAction: 'none',
      }}
    >
      {DIRECTIONS.map((dir) => (
        <div
          key={dir}
          ref={(el) => { zoneRefs.current[dir] = el; }}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: ZONE_COLORS[dir],
            border: `1px solid ${ZONE_BORDER_COLORS[dir]}`,
            borderBottom: 'none',
            borderTop: `2px solid ${ZONE_BORDER_COLORS[dir]}`,
            transition: 'background-color 0.12s ease-out, box-shadow 0.12s ease-out',
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          <span
            style={{
              fontSize: 'clamp(2rem, 8vw, 3.5rem)',
              color: ZONE_GLOW_COLORS[dir],
              textShadow: `0 0 12px ${ZONE_GLOW_COLORS[dir]}, 0 0 24px ${ZONE_GLOW_COLORS[dir]}`,
              opacity: 0.85,
              pointerEvents: 'none',
            }}
          >
            {ZONE_LABELS[dir]}
          </span>
        </div>
      ))}
    </div>
  );
}
