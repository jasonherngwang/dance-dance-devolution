import { useNavigate } from 'react-router-dom';

// Placeholder — full progress polling UI built in Issue 30
export default function LoadingScreen() {
  const navigate = useNavigate();

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-game-bg gap-6">
      <div
        className="text-2xl font-black tracking-widest text-neon-orange"
        style={{ textShadow: '0 0 16px #ff8800' }}
      >
        ANALYZING...
      </div>
      <p className="text-game-text-dim text-sm text-center px-8">
        Analysis progress screen coming in Issue 30.
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
