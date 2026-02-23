import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GameCanvas } from '@/components/GameCanvas';
import { useGameStore } from '@/stores';

export default function GameplayScreen() {
  const navigate = useNavigate();
  const activeSong       = useGameStore(state => state.activeSong);
  const activeDifficulty = useGameStore(state => state.activeDifficulty);
  const gameState        = useGameStore(state => state.gameState);

  // Navigate to results when real game ends.
  // Demo mode (activeSong=null) never navigates away automatically.
  useEffect(() => {
    if (gameState === 'ended' && activeSong !== null) {
      navigate('/results');
    }
  }, [gameState, activeSong, navigate]);

  return (
    <div className="h-full w-full bg-game-bg">
      <GameCanvas chartData={activeSong} difficulty={activeDifficulty} />
    </div>
  );
}
