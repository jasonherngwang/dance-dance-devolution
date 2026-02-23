import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/stores';

const GRADE_COLORS: Record<string, string> = {
  S: '#ffff00',
  A: '#00ffff',
  B: '#00ff88',
  C: '#ff8800',
  D: '#ff4444',
};

export default function ResultsScreen() {
  const navigate         = useNavigate();
  const gameResult       = useGameStore(state => state.gameResult);
  const activeSong       = useGameStore(state => state.activeSong);
  const activeDifficulty = useGameStore(state => state.activeDifficulty);
  const setActiveSong    = useGameStore(state => state.setActiveSong);
  const resetGame        = useGameStore(state => state.resetGame);

  // Guard: redirect home if there's no result (e.g., direct URL access)
  useEffect(() => {
    if (!gameResult || !activeSong) {
      navigate('/', { replace: true });
    }
  }, [gameResult, activeSong, navigate]);

  if (!gameResult || !activeSong) return null;

  const gradeColor = GRADE_COLORS[gameResult.grade] ?? '#ffffff';

  function handleRetry() {
    resetGame();
    setActiveSong(activeSong!, activeDifficulty);
    navigate('/play');
  }

  function handleNewSong() {
    navigate('/');
  }

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
            linear-gradient(rgba(0,255,255,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
        }}
      />
      {/* Radial vignette */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 80% 70% at 50% 40%, transparent 0%, rgba(8,8,16,0.92) 100%)',
        }}
      />
      {/* Grade-colored ambient glow — centers on the grade */}
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 55% 45% at 50% 38%, ${gradeColor}0c 0%, transparent 70%)`,
          transition: 'background 0.4s',
        }}
      />

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center px-4 pt-12 pb-28 min-h-full">

        {/* STAGE CLEAR header */}
        <h1
          className="text-sm tracking-[0.5em] select-none"
          style={{
            color: '#00ffff',
            textShadow: '0 0 18px #00ffff, 0 0 50px rgba(0,255,255,0.38)',
            animation: 'results-header-in 0.55s ease-out forwards',
          }}
        >
          ★ &nbsp;STAGE CLEAR&nbsp; ★
        </h1>

        {/* Song title + artist + difficulty */}
        <div
          className="mt-4 text-center select-none"
          style={{ animation: 'results-fade-up 0.5s 0.15s ease-out both' }}
        >
          <div
            className="text-xl font-black tracking-wide"
            style={{ color: 'rgba(255,255,255,0.88)' }}
          >
            {activeSong.title}
          </div>
          <div
            className="mt-1 text-xs tracking-[0.22em]"
            style={{ color: 'rgba(255,255,255,0.36)' }}
          >
            {activeSong.artist.toUpperCase()}
            &nbsp;·&nbsp;
            {activeDifficulty.toUpperCase()}
          </div>
        </div>

        {/* ── Grade — dramatic animated reveal ─────────────────────────────── */}
        <div
          className="mt-8 relative flex items-center justify-center select-none"
          style={{ animation: 'results-grade-reveal 0.65s 0.28s cubic-bezier(0.34,1.56,0.64,1) both' }}
        >
          {/* Soft glow disc behind grade letter */}
          <div
            style={{
              position: 'absolute',
              width: 160,
              height: 160,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${gradeColor}20 0%, transparent 70%)`,
              pointerEvents: 'none',
            }}
          />
          <div
            className="font-black leading-none"
            style={{
              fontSize: 'clamp(7rem, 18vw, 9.5rem)',
              color: gradeColor,
              textShadow: `
                0 0 24px ${gradeColor},
                0 0 60px ${gradeColor}88,
                0 0 110px ${gradeColor}44
              `,
            }}
          >
            {gameResult.grade}
          </div>
        </div>

        {/* ── Stats panel ──────────────────────────────────────────────────── */}
        <div
          className="mt-8 w-full max-w-xs"
          style={{
            animation: 'results-fade-up 0.5s 0.55s ease-out both',
            background: 'rgba(255,255,255,0.028)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <StatRow label="SCORE"     value={gameResult.score.toLocaleString()} color="#ffffff"   last={false} />
          <StatRow label="PERFECT"   value={String(gameResult.perfect)}        color="#ffff00"   last={false} />
          <StatRow label="GREAT"     value={String(gameResult.great)}          color="#00ffff"   last={false} />
          <StatRow label="MISS"      value={String(gameResult.miss)}           color="#ff4444"   last={false} />
          <StatRow label="MAX COMBO" value={String(gameResult.maxCombo)}       color="#ff8800"   last={false} />
          <StatRow label="ACCURACY"  value={`${gameResult.accuracy.toFixed(1)}%`} color="#00ff88" last={true} />
        </div>

        {/* ── Action buttons ───────────────────────────────────────────────── */}
        <div
          className="flex gap-4 mt-8"
          style={{ animation: 'results-fade-up 0.5s 0.72s ease-out both' }}
        >
          <ActionButton label="↺  RETRY"    color="#ff8800" onClick={handleRetry}  />
          <ActionButton label="⌂  NEW SONG" color="#00ffff" onClick={handleNewSong} />
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  color,
  last,
}: {
  label: string;
  value: string;
  color: string;
  last: boolean;
}) {
  return (
    <div
      className="flex justify-between items-center px-5 py-2.5"
      style={last ? undefined : { borderBottom: '1px solid rgba(255,255,255,0.05)' }}
    >
      <span
        className="text-xs tracking-[0.22em] select-none"
        style={{ color: 'rgba(255,255,255,0.36)' }}
      >
        {label}
      </span>
      <span
        className="font-mono font-bold text-sm"
        style={{
          color,
          textShadow: color !== '#ffffff' ? `0 0 8px ${color}55` : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      className="px-7 py-3 font-bold tracking-widest text-sm transition-all duration-150"
      style={{
        border: `2px solid ${color}`,
        color,
        background: `${color}0d`,
        textShadow: `0 0 10px ${color}55`,
      }}
      onClick={onClick}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = `${color}1e`;
        el.style.boxShadow  = `0 0 22px ${color}33`;
        el.style.transform  = 'scale(1.04)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.background = `${color}0d`;
        el.style.boxShadow  = '';
        el.style.transform  = '';
      }}
    >
      {label}
    </button>
  );
}
