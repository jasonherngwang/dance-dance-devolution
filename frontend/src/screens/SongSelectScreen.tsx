import { useNavigate } from 'react-router-dom';

// Placeholder — full song select grid built in Issue 21
export default function SongSelectScreen() {
  const navigate = useNavigate();

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-game-bg gap-6">
      <h2
        className="text-3xl font-black tracking-widest text-neon-magenta"
        style={{ textShadow: '0 0 16px #ff00ff' }}
      >
        SONG SELECT
      </h2>
      <p className="text-game-text-dim text-sm text-center px-8">
        Song catalog coming in Issue 21.<br />
        Pre-loaded songs will appear here.
      </p>
      <button
        className="mt-4 px-6 py-2 border border-game-border text-game-text-dim hover:border-neon-cyan hover:text-neon-cyan transition-colors text-sm tracking-widest"
        onClick={() => navigate('/')}
      >
        ← BACK
      </button>
    </div>
  );
}
