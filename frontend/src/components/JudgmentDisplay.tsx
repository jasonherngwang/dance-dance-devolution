import { useEffect, useRef, useState } from 'react';
import type { Direction, JudgmentType } from '@/types';

// Classic DDR judgment labels
const JUDGMENT_LABELS: Record<JudgmentType, string> = {
  perfect: 'PERFECT!!',
  great:   'GREAT!',
  miss:    'MISS',
};

// Classic DDR judgment colors — saturated, bright
const JUDGMENT_COLORS: Record<JudgmentType, string> = {
  perfect: '#ffee00',
  great:   '#88ff00',
  miss:    '#ff3333',
};

// Extra drop-shadow filter for PERFECT (orange fire glow below text)
const JUDGMENT_FILTER: Record<JudgmentType, string | undefined> = {
  perfect: 'drop-shadow(0 4px 8px #ff7700) drop-shadow(0 2px 4px #ff4400)',
  great:   undefined,
  miss:    undefined,
};

interface JudgmentEntry {
  id: number;
  type: JudgmentType;
  text: string;
  color: string;
  filter: string | undefined;
}

let _nextId = 0;

interface Props {
  onRegisterTrigger: (fn: (judgment: JudgmentType, direction: Direction) => void) => void;
}

export function JudgmentDisplay({ onRegisterTrigger }: Props) {
  const [entries, setEntries] = useState<JudgmentEntry[]>([]);
  const timeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    onRegisterTrigger((judgment: JudgmentType, _direction: Direction) => {
      const id = _nextId++;
      const entry: JudgmentEntry = {
        id,
        type:   judgment,
        text:   JUDGMENT_LABELS[judgment],
        color:  JUDGMENT_COLORS[judgment],
        filter: JUDGMENT_FILTER[judgment],
      };
      setEntries(prev => [...prev, entry]);

      const t = setTimeout(() => {
        setEntries(prev => prev.filter(e => e.id !== id));
        timeoutsRef.current.delete(t);
      }, 950);
      timeoutsRef.current.add(t);
    });

    return () => {
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
            left:      '50%',
            top:       '43%',
            transform: 'translateX(-50%)',
            color:     entry.color,
            filter:    entry.filter,
          } as React.CSSProperties}
        >
          {entry.text}
        </div>
      ))}
    </div>
  );
}
