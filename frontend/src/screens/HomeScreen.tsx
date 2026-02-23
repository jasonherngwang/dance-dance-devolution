import { useState, useEffect, useCallback } from 'react';
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

export default function HomeScreen() {
  const navigate      = useNavigate();
  const setActiveSong = useGameStore(state => state.setActiveSong);
  const resetGame     = useGameStore(state => state.resetGame);

  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  // Cache: chart_url → ChartData
  const [charts, setCharts] = useState<Record<string, ChartData>>({});
  const [ytUrl, setYtUrl] = useState('');

  // Load catalog on mount, then pre-fetch each song's chart
  useEffect(() => {
    fetch('/data/catalog.json')
      .then(r => r.json() as Promise<CatalogEntry[]>)
      .then(entries => {
        setCatalog(entries);
        // Pre-fetch every chart so buttons are ready quickly
        entries.forEach(entry => {
          fetch(entry.chart_url)
            .then(r => r.json() as Promise<ChartData>)
            .then(chart => setCharts(prev => ({ ...prev, [entry.chart_url]: chart })))
            .catch(() => {/* non-fatal */});
        });
      })
      .catch(() => {/* non-fatal in dev */});
  }, []);

  const play = useCallback((entry: CatalogEntry, difficulty: Difficulty) => {
    const chart = charts[entry.chart_url];
    if (!chart) return;
    resetGame();
    setActiveSong(chart, difficulty);
    navigate('/play');
  }, [charts, resetGame, setActiveSong, navigate]);

  const handleAnalyze = useCallback(() => {
    if (!ytUrl.trim()) return;
    navigate('/loading');
  }, [ytUrl, navigate]);

  const featured = catalog.find(e => e.featured);
  const featuredChart = featured ? charts[featured.chart_url] : null;

  return (
    <div
      className="relative h-full w-full"
      style={{ overflowY: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}
    >
      {/* ── Neon grid background ──────────────────────────────────────────── */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,255,0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.055) 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
        }}
      />
      {/* Vignette over grid — darkens edges, keeps center readable */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse 75% 65% at 50% 25%, transparent 0%, rgba(8,8,16,0.88) 100%),
            linear-gradient(to top, rgba(8,8,16,0.98) 0%, transparent 18%)
          `,
        }}
      />
      {/* Subtle horizontal scan-line texture */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 4px)',
          backgroundSize: '100% 4px',
        }}
      />

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-16 pb-24 min-h-full">

        {/* Title */}
        <h1
          className="text-5xl sm:text-7xl font-black tracking-[0.12em] text-center leading-none select-none"
          style={{
            color: '#00ffff',
            textShadow: '0 0 18px #00ffff, 0 0 50px rgba(0,255,255,0.45), 0 0 100px rgba(0,255,255,0.18)',
          }}
        >
          DANCE DANCE
          <br />
          DEVOLUTION
        </h1>
        <p
          className="mt-4 text-xs sm:text-sm tracking-[0.28em] text-center select-none"
          style={{ color: 'rgba(255,255,255,0.42)' }}
        >
          A RHYTHM GAME POWERED BY WEBGPU + AI
        </p>

        {/* ── Featured song ─────────────────────────────────────────────── */}
        {featured && (
          <div className="mt-14 w-full max-w-md">
            <SectionLabel text="★  FEATURED SONG" />
            <div
              className="p-6"
              style={{
                background: 'linear-gradient(135deg, rgba(255,0,255,0.07) 0%, rgba(0,255,255,0.05) 100%)',
                border: '1px solid rgba(255,0,255,0.28)',
                boxShadow: '0 0 36px rgba(255,0,255,0.09), inset 0 0 24px rgba(255,0,255,0.04)',
              }}
            >
              <div className="flex items-start gap-4">
                {/* Thumbnail */}
                <div
                  className="shrink-0"
                  style={{
                    width: 72,
                    height: 72,
                    border: '1px solid rgba(255,0,255,0.3)',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={featured.thumbnail_url}
                    alt={featured.title}
                    width={72}
                    height={72}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className="text-2xl font-black tracking-widest truncate"
                      style={{ color: '#ff00ff', textShadow: '0 0 14px rgba(255,0,255,0.8)' }}
                    >
                      {featured.title.toUpperCase()}
                    </div>
                    <span
                      className="text-xs px-2 py-1 shrink-0"
                      style={{
                        border: '1px solid rgba(255,0,255,0.3)',
                        color: 'rgba(255,0,255,0.65)',
                      }}
                    >
                      ★ FEATURED
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    {featured.artist}&nbsp;·&nbsp;{featured.bpm} BPM
                  </div>
                </div>
              </div>
              <div className="mt-5 flex gap-3">
                <DiffButton
                  label="▶ PLAY EASY"
                  color="#00ffff"
                  bg="rgba(0,255,255,0.11)"
                  disabled={!featuredChart}
                  onClick={() => play(featured, 'easy')}
                />
                <DiffButton
                  label="▶ PLAY HARD"
                  color="#ff8800"
                  bg="rgba(255,136,0,0.11)"
                  disabled={!featuredChart}
                  onClick={() => play(featured, 'hard')}
                />
              </div>
            </div>
          </div>
        )}

        {/* ── Song thumbnails ───────────────────────────────────────────── */}
        <div className="mt-10 w-full max-w-md">
          <SectionLabel text="PICK A SONG" />
          <div className="grid grid-cols-3 gap-3">
            {catalog.map((entry) => (
              <SongCard
                key={entry.id}
                entry={entry}
                color={SONG_COLORS[entry.id] ?? '#ffffff'}
                onClick={() => play(entry, 'easy')}
              />
            ))}
          </div>
          <HoverButton
            className="mt-3 w-full py-2 text-xs tracking-widest"
            baseStyle={{ border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.38)' }}
            hoverStyle={{ color: '#00ffff', borderColor: 'rgba(0,255,255,0.3)' }}
            onClick={() => navigate('/select')}
          >
            VIEW ALL SONGS →
          </HoverButton>
        </div>

        {/* ── YouTube input ─────────────────────────────────────────────── */}
        <div className="mt-10 w-full max-w-md">
          <SectionLabel text="CUSTOM SONG (YOUTUBE)" />
          <div className="flex gap-2">
            <input
              type="url"
              value={ytUrl}
              onChange={e => setYtUrl(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 px-4 py-3 text-sm outline-none"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: 'rgba(255,255,255,0.9)',
                fontFamily: 'inherit',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => { (e.target as HTMLInputElement).style.borderColor = 'rgba(0,255,255,0.38)'; }}
              onBlur={e  => { (e.target as HTMLInputElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
            />
            <button
              className="px-5 py-3 font-bold tracking-widest text-sm whitespace-nowrap transition-all duration-150"
              style={{
                background: ytUrl.trim() ? 'rgba(255,0,255,0.13)' : 'rgba(255,255,255,0.04)',
                border: `2px solid ${ytUrl.trim() ? 'rgba(255,0,255,0.6)' : 'rgba(255,255,255,0.1)'}`,
                color: ytUrl.trim() ? '#ff00ff' : 'rgba(255,255,255,0.25)',
                cursor: ytUrl.trim() ? 'pointer' : 'default',
              }}
              onClick={handleAnalyze}
            >
              ANALYZE
            </button>
          </div>
          <p className="mt-2 text-xs" style={{ color: 'rgba(255,255,255,0.24)' }}>
            AI-powered chart generation&nbsp;·&nbsp;~30 seconds&nbsp;·&nbsp;full song catalog supported
          </p>
        </div>

      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div
        className="fixed bottom-0 left-0 right-0 py-3 text-center text-xs tracking-[0.22em] pointer-events-none z-20 select-none"
        style={{
          color: 'rgba(255,255,255,0.26)',
          background: 'linear-gradient(transparent, rgba(8,8,16,0.96))',
        }}
      >
        USE ARROW KEYS (DESKTOP) OR TAP ZONES (MOBILE) TO PLAY
      </div>
    </div>
  );
}

// ── Small reusable sub-components ──────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <p
      className="text-xs tracking-[0.3em] mb-3 select-none"
      style={{ color: 'rgba(255,255,255,0.32)' }}
    >
      {text}
    </p>
  );
}

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
      className="flex-1 py-3 font-bold tracking-widest text-sm transition-all duration-150"
      style={{
        background: disabled ? 'rgba(255,255,255,0.03)' : bg,
        border: `2px solid ${disabled ? 'rgba(255,255,255,0.1)' : color}`,
        color: disabled ? 'rgba(255,255,255,0.18)' : color,
        textShadow: disabled ? 'none' : `0 0 10px ${color}`,
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

function SongCard({
  entry,
  color,
  onClick,
}: {
  entry: CatalogEntry;
  color: string;
  onClick: () => void;
}) {
  const handleEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.borderColor = `${color}55`;
    el.style.boxShadow = `0 0 18px ${color}18`;
    el.style.transform = 'scale(1.03)';
  };
  const handleLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.borderColor = `${color}1a`;
    el.style.boxShadow = '';
    el.style.transform = '';
  };

  return (
    <button
      className="flex flex-col items-start p-3 text-left w-full transition-all duration-150"
      style={{
        background: `linear-gradient(135deg, ${color}0d, transparent)`,
        border: `1px solid ${color}1a`,
      }}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={onClick}
    >
      {/* Thumbnail */}
      <div
        className="w-full aspect-square mb-2 flex items-center justify-center text-3xl overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${color}16, ${color}06)`,
          border: `1px solid ${color}16`,
          color: color,
          textShadow: `0 0 14px ${color}`,
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
      <div
        className="text-xs font-bold tracking-wide truncate w-full"
        style={{ color: color, textShadow: `0 0 6px ${color}` }}
      >
        {entry.title}
      </div>
      <div className="text-xs mt-0.5 truncate w-full" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {entry.artist}
      </div>
      <div className="text-xs mt-0.5" style={{ color: 'rgba(255,255,255,0.27)' }}>
        {entry.bpm} BPM
      </div>
    </button>
  );
}

interface HoverButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  baseStyle: React.CSSProperties;
  hoverStyle: React.CSSProperties;
}

function HoverButton({ baseStyle, hoverStyle, onMouseEnter, onMouseLeave, style, ...props }: HoverButtonProps) {
  return (
    <button
      {...props}
      style={{ ...baseStyle, transition: 'color 0.15s, border-color 0.15s', ...style }}
      onMouseEnter={e => {
        Object.assign((e.currentTarget as HTMLElement).style, hoverStyle);
        onMouseEnter?.(e);
      }}
      onMouseLeave={e => {
        Object.assign((e.currentTarget as HTMLElement).style, baseStyle);
        onMouseLeave?.(e);
      }}
    />
  );
}
