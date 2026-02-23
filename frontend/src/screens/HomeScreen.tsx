import { useNavigate } from 'react-router-dom';

export default function HomeScreen() {
  const navigate = useNavigate();

  return (
    <div className="h-full w-full flex flex-col items-center justify-center bg-game-bg relative">
      {/* Title */}
      <h1
        className="text-4xl sm:text-5xl font-black tracking-widest text-neon-cyan text-center"
        style={{ textShadow: '0 0 20px #00ffff, 0 0 40px #00ffff66' }}
      >
        DANCE DANCE
        <br />
        DEVOLUTION
      </h1>
      <p className="mt-3 text-game-text-dim text-xs tracking-widest text-center">
        A RHYTHM GAME POWERED BY WEBGPU + AI
      </p>

      {/* Action buttons */}
      <div className="mt-12 flex flex-col gap-4 items-center w-full max-w-xs px-4">
        <button
          className="w-full px-8 py-4 border-2 border-neon-cyan text-neon-cyan text-base font-bold tracking-widest hover:bg-neon-cyan/10 transition-colors"
          onClick={() => navigate('/play')}
        >
          ▶ DEMO MODE
        </button>
        <button
          className="w-full px-8 py-4 border-2 border-neon-magenta text-neon-magenta text-base font-bold tracking-widest hover:bg-neon-magenta/10 transition-colors"
          onClick={() => navigate('/select')}
        >
          ♪ PICK A SONG
        </button>
      </div>

      {/* Footer hint */}
      <p className="absolute bottom-6 text-game-text-dim text-xs tracking-widest text-center px-4">
        ARROW KEYS / DFJK (DESKTOP) · TAP ZONES (MOBILE)
      </p>
    </div>
  );
}
