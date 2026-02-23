import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/stores';
import type { CatalogEntry } from '@/types/catalog';
import type { ChartData, Difficulty } from '@/types';

// Color accent per song id for theming
const SONG_COLORS: Record<string, string> = {
  'sandstorm': '#ff00ff',
  'butterfly': '#00ffff',
  'blinding-lights': '#ff8800',
};

export default function SongSelectScreen() {
  const navigate = useNavigate();
  const setActiveSong = useGameStore(state => state.setActiveSong);
  const resetGame = useGameStore(state => state.resetGame);

  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  // Cache chart per chart_url so we don't re-fetch when switching difficulties
  const [charts, setCharts] = useState<Record<string, ChartData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Load catalog then pre-fetch all charts on mount
  useEffect(() => {
    fetch('/data/catalog.json')
      .then(r => r.json() as Promise<CatalogEntry[]>)
      .then(entries => {
        setCatalog(entries);
        const unique = [...new Set(entries.map(e => e.chart_url))];
        unique.forEach(url => {
          setLoading(prev => ({ ...prev, [url]: true }));
          fetch(url)
            .then(r => r.json() as Promise<ChartData>)
            .then(data => {
              setCharts(prev => ({ ...prev, [url]: data }));
              setLoading(prev => ({ ...prev, [url]: false }));
            })
            .catch(() => setLoading(prev => ({ ...prev, [url]: false })));
        });
      })
      .catch(() => {/* non-fatal */});
  }, []);

  const play = useCallback(
    (entry: CatalogEntry, difficulty: Difficulty) => {
      const chart = charts[entry.chart_url];
      if (!chart) return;
      resetGame();
      setActiveSong(chart, difficulty);
      navigate('/play');
    },
    [charts, resetGame, setActiveSong, navigate],
  );

  return (
    <div
      className="relative h-full w-full"
      style={{ overflowY: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}
    >
      {/* ── Background ────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,255,0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.045) 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 75% 65% at 50% 25%, transparent 0%, rgba(8,8,16,0.9) 100%),
            linear-gradient(to top, rgba(8,8,16,0.98) 0%, transparent 20%)
          `,
        }}
      />

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-14 pb-24 min-h-full">

        {/* Header */}
        <div className="w-full max-w-2xl flex items-center gap-4 mb-8">
          <button
            className="text-xs tracking-widest transition-colors duration-150"
            style={{ color: 'rgba(255,255,255,0.32)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ffff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.32)'; }}
            onClick={() => navigate('/')}
          >
            ← BACK
          </button>
          <h1
            className="text-3xl font-black tracking-[0.15em] select-none"
            style={{
              color: '#00ffff',
              textShadow: '0 0 14px #00ffff, 0 0 40px rgba(0,255,255,0.3)',
            }}
          >
            SONG SELECT
          </h1>
        </div>

        {/* Song list */}
        <div className="w-full max-w-2xl grid grid-cols-1 gap-4">
          {catalog.map(entry => (
            <SongCard
              key={entry.id}
              entry={entry}
              color={SONG_COLORS[entry.id] ?? '#ffffff'}
              isLoading={!!loading[entry.chart_url]}
              hasChart={!!charts[entry.chart_url]}
              onPlay={difficulty => play(entry, difficulty)}
            />
          ))}
        </div>

      </div>
    </div>
  );
}

// ── SongCard ─────────────────────────────────────────────────────────────────

function SongCard({
  entry,
  color,
  isLoading,
  hasChart,
  onPlay,
}: {
  entry: CatalogEntry;
  color: string;
  isLoading: boolean;
  hasChart: boolean;
  onPlay: (difficulty: Difficulty) => void;
}) {
  const disabled = isLoading || !hasChart;

  return (
    <div
      className="flex gap-4 p-4 transition-all duration-150"
      style={{
        background: `linear-gradient(135deg, ${color}08, rgba(8,8,16,0.6))`,
        border: `1px solid ${color}22`,
        boxShadow: `0 0 24px ${color}06`,
      }}
    >
      {/* Thumbnail */}
      <div
        className="shrink-0 flex items-center justify-center text-4xl select-none overflow-hidden"
        style={{
          width: 80,
          height: 80,
          background: `linear-gradient(135deg, ${color}18, ${color}06)`,
          border: `1px solid ${color}18`,
          color: color,
          textShadow: `0 0 16px ${color}`,
        }}
      >
        <img
          src={entry.thumbnail_url}
          alt={entry.title}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={e => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>

      {/* Info + buttons */}
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-xl font-black tracking-wide truncate"
              style={{ color: color, textShadow: `0 0 10px ${color}88` }}
            >
              {entry.title}
            </span>
            {entry.featured && (
              <span
                className="text-xs px-2 py-0.5 shrink-0"
                style={{ border: `1px solid ${color}44`, color: `${color}99` }}
              >
                ★ FEATURED
              </span>
            )}
          </div>
          <div className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {entry.artist}
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>&nbsp;·&nbsp;</span>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>{entry.bpm} BPM</span>
          </div>
        </div>

        <div className="flex gap-2">
          <DiffButton
            label={isLoading ? 'LOADING...' : '▶ EASY'}
            color="#00ffff"
            bg="rgba(0,255,255,0.1)"
            disabled={disabled}
            onClick={() => onPlay('easy')}
          />
          <DiffButton
            label={isLoading ? 'LOADING...' : '▶ HARD'}
            color="#ff8800"
            bg="rgba(255,136,0,0.1)"
            disabled={disabled}
            onClick={() => onPlay('hard')}
          />
        </div>
      </div>
    </div>
  );
}

// ── DiffButton ────────────────────────────────────────────────────────────────

function DiffButton({
  label,
  color,
  bg,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  bg: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex-1 py-2 font-bold tracking-widest text-sm transition-all duration-150"
      style={{
        background: disabled ? 'rgba(255,255,255,0.03)' : bg,
        border: `2px solid ${disabled ? 'rgba(255,255,255,0.1)' : color}`,
        color: disabled ? 'rgba(255,255,255,0.18)' : color,
        textShadow: disabled ? 'none' : `0 0 8px ${color}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={e => {
        if (!disabled) (e.currentTarget as HTMLElement).style.transform = 'scale(1.02)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.transform = '';
      }}
    >
      {label}
    </button>
  );
}
