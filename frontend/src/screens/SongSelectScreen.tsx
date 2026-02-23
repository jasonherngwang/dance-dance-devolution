import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/stores';
import type { ChartData, Difficulty } from '@/types';

// Catalog entries — real audio/chart files added in Issue 23.
// For now, all entries share the test chart; audio_url per entry overrides later.
const CATALOG = [
  {
    id: 'sandstorm',
    title: 'Sandstorm',
    artist: 'Darude',
    bpm: 136,
    color: '#ff00ff',
    featured: true,
    chartUrl: '/data/test-chart.json',
  },
  {
    id: 'butterfly',
    title: 'Butterfly',
    artist: 'Smile.dk',
    bpm: 154,
    color: '#00ffff',
    featured: false,
    chartUrl: '/data/test-chart.json',
  },
  {
    id: 'blinding-lights',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    bpm: 171,
    color: '#ff8800',
    featured: false,
    chartUrl: '/data/test-chart.json',
  },
] as const;

type CatalogItem = (typeof CATALOG)[number];

export default function SongSelectScreen() {
  const navigate = useNavigate();
  const setActiveSong = useGameStore(state => state.setActiveSong);
  const resetGame = useGameStore(state => state.resetGame);

  // Cache chart per URL so we don't re-fetch when switching difficulties
  const [charts, setCharts] = useState<Record<string, ChartData>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  // Pre-fetch all unique chart URLs on mount
  useEffect(() => {
    const unique = [...new Set(CATALOG.map(s => s.chartUrl))];
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
  }, []);

  const play = useCallback(
    (song: CatalogItem, difficulty: Difficulty) => {
      const chart = charts[song.chartUrl];
      if (!chart) return;
      resetGame();
      // Patch in catalog metadata so the results screen shows the right song name
      setActiveSong({ ...chart, title: song.title, artist: song.artist, bpm: song.bpm }, difficulty);
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

        {/* Song grid */}
        <div className="w-full max-w-2xl grid grid-cols-1 gap-4">
          {CATALOG.map(song => (
            <SongCard
              key={song.id}
              song={song}
              isLoading={!!loading[song.chartUrl]}
              hasChart={!!charts[song.chartUrl]}
              onPlay={difficulty => play(song, difficulty)}
            />
          ))}
        </div>

      </div>
    </div>
  );
}

// ── SongCard ─────────────────────────────────────────────────────────────────

function SongCard({
  song,
  isLoading,
  hasChart,
  onPlay,
}: {
  song: CatalogItem;
  isLoading: boolean;
  hasChart: boolean;
  onPlay: (difficulty: Difficulty) => void;
}) {
  const disabled = isLoading || !hasChart;

  return (
    <div
      className="flex gap-4 p-4 transition-all duration-150"
      style={{
        background: `linear-gradient(135deg, ${song.color}08, rgba(8,8,16,0.6))`,
        border: `1px solid ${song.color}22`,
        boxShadow: `0 0 24px ${song.color}06`,
      }}
    >
      {/* Thumbnail */}
      <div
        className="shrink-0 flex items-center justify-center text-4xl select-none"
        style={{
          width: 80,
          height: 80,
          background: `linear-gradient(135deg, ${song.color}18, ${song.color}06)`,
          border: `1px solid ${song.color}18`,
          color: song.color,
          textShadow: `0 0 16px ${song.color}`,
        }}
      >
        ♪
      </div>

      {/* Info + buttons */}
      <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-xl font-black tracking-wide truncate"
              style={{ color: song.color, textShadow: `0 0 10px ${song.color}88` }}
            >
              {song.title}
            </span>
            {song.featured && (
              <span
                className="text-xs px-2 py-0.5 shrink-0"
                style={{ border: `1px solid ${song.color}44`, color: `${song.color}99` }}
              >
                ★ FEATURED
              </span>
            )}
          </div>
          <div className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {song.artist}
            <span style={{ color: 'rgba(255,255,255,0.25)' }}>&nbsp;·&nbsp;</span>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>{song.bpm} BPM</span>
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
