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

// Basic results screen — visual polish pass in Issue 22
export default function ResultsScreen() {
  const navigate = useNavigate();
  const gameResult       = useGameStore(state => state.gameResult);
  const activeSong       = useGameStore(state => state.activeSong);
  const activeDifficulty = useGameStore(state => state.activeDifficulty);
  const setActiveSong    = useGameStore(state => state.setActiveSong);

  // Guard: redirect home if there's no result (e.g., direct URL access)
  useEffect(() => {
    if (!gameResult || !activeSong) {
      navigate('/', { replace: true });
    }
  }, [gameResult, activeSong, navigate]);

  if (!gameResult || !activeSong) return null;

  const gradeColor = GRADE_COLORS[gameResult.grade] ?? '#ffffff';

  function handleRetry() {
    // setActiveSong preserves the selection; GameCanvas resets scoring on mount
    setActiveSong(activeSong!, activeDifficulty);
    navigate('/play');
  }

  function handleNewSong() {
    navigate('/select');
  }

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-game-bg gap-5 overflow-y-auto py-8">
      {/* Header */}
      <h1
        className="text-3xl font-black tracking-widest text-neon-cyan"
        style={{ textShadow: '0 0 20px #00ffff' }}
      >
        STAGE CLEAR
      </h1>

      <p className="text-game-text-dim text-xs tracking-widest text-center">
        {activeSong.title.toUpperCase()} &mdash; {activeSong.artist.toUpperCase()}
        {' '}&mdash;{' '}
        {activeDifficulty.toUpperCase()}
      </p>

      {/* Grade */}
      <div
        className="text-9xl font-black leading-none mt-2"
        style={{ color: gradeColor, textShadow: `0 0 30px ${gradeColor}, 0 0 60px ${gradeColor}66` }}
      >
        {gameResult.grade}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-x-16 gap-y-2 text-sm mt-2">
        <span className="text-game-text-dim tracking-widest">SCORE</span>
        <span className="text-right font-mono text-white">{gameResult.score.toLocaleString()}</span>

        <span className="text-game-text-dim tracking-widest">PERFECT</span>
        <span className="text-right font-mono text-neon-yellow">{gameResult.perfect}</span>

        <span className="text-game-text-dim tracking-widest">GREAT</span>
        <span className="text-right font-mono text-neon-cyan">{gameResult.great}</span>

        <span className="text-game-text-dim tracking-widest">MISS</span>
        <span className="text-right font-mono" style={{ color: '#ff4444' }}>{gameResult.miss}</span>

        <span className="text-game-text-dim tracking-widest">MAX COMBO</span>
        <span className="text-right font-mono text-neon-orange">{gameResult.maxCombo}</span>

        <span className="text-game-text-dim tracking-widest">ACCURACY</span>
        <span className="text-right font-mono text-neon-green">{gameResult.accuracy.toFixed(1)}%</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-6 mt-4">
        <button
          className="px-6 py-3 border-2 border-neon-orange text-neon-orange font-bold tracking-widest hover:bg-neon-orange/10 transition-colors"
          onClick={handleRetry}
        >
          RETRY
        </button>
        <button
          className="px-6 py-3 border-2 border-neon-cyan text-neon-cyan font-bold tracking-widest hover:bg-neon-cyan/10 transition-colors"
          onClick={handleNewSong}
        >
          NEW SONG
        </button>
      </div>
    </div>
  );
}
