import { useEffect, useRef, useState } from 'react';
import type { Direction, JudgmentType } from '@/types';

// ---------------------------------------------------------------------------
// Column X positions as approximate CSS left% for a 16:9 display.
// World-space columns are at -1.5, -0.5, +0.5, +1.5 in a ±8.9 wide view.
// ---------------------------------------------------------------------------

const COLUMN_LEFT_PCT: Record<Direction, number> = {
  left:  41,
  down:  46,
  up:    54,
  right: 59,
};

const JUDGMENT_LABELS: Record<JudgmentType, string> = {
  perfect: 'PERFECT!',
  great:   'GREAT!',
  miss:    'MISS',
};

const JUDGMENT_COLORS: Record<JudgmentType, string> = {
  perfect: '#ffdd00',
  great:   '#44ccff',
  miss:    '#ff4444',
};

// ---------------------------------------------------------------------------
// Internal entry type
// ---------------------------------------------------------------------------

interface JudgmentEntry {
  id: number;
  text: string;
  color: string;
  leftPct: number;
}

let _nextId = 0;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /**
   * Called once on mount with a trigger function the parent stores in a ref.
   * The trigger is called from the Three.js animation loop to push new texts.
   */
  onRegisterTrigger: (fn: (judgment: JudgmentType, direction: Direction) => void) => void;
}

// ---------------------------------------------------------------------------
// JudgmentDisplay
// ---------------------------------------------------------------------------

/**
 * HTML overlay that renders animated judgment text (PERFECT!, GREAT!, MISS)
 * on top of the Three.js canvas.
 *
 * Text floats upward and fades over ~0.75s. Multiple texts can coexist.
 * Positioned approximately over the correct column.
 */
export function JudgmentDisplay({ onRegisterTrigger }: Props) {
  const [entries, setEntries] = useState<JudgmentEntry[]>([]);
  // Use a ref for the timeout IDs so we can clear on unmount
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    // Register the trigger function with the parent
    onRegisterTrigger((judgment: JudgmentType, direction: Direction) => {
      const id = _nextId++;
      const entry: JudgmentEntry = {
        id,
        text:    JUDGMENT_LABELS[judgment],
        color:   JUDGMENT_COLORS[judgment],
        leftPct: COLUMN_LEFT_PCT[direction],
      };
      setEntries(prev => [...prev, entry]);

      // Remove after animation completes (750ms animation + small buffer)
      const t = setTimeout(() => {
        setEntries(prev => prev.filter(e => e.id !== id));
        timeoutsRef.current.delete(t);
      }, 900);
      timeoutsRef.current.add(t);
    });

    return () => {
      // Cancel any pending removals on unmount
      for (const t of timeoutsRef.current) clearTimeout(t);
      timeoutsRef.current.clear();
    };
  }, [onRegisterTrigger]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {entries.map(entry => (
        <div
          key={entry.id}
          className="judgment-text absolute"
          style={{
            left:      `${entry.leftPct}%`,
            top:       '22%', // slightly below receptor zone (~15% from top)
            transform: 'translateX(-50%)',
            color:     entry.color,
          }}
        >
          {entry.text}
        </div>
      ))}
    </div>
  );
}
