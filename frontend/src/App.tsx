import { GameCanvas } from '@/components/GameCanvas';
import { useGameStore } from '@/stores';

function App() {
  // Subscribe only to song selection — score/combo changes don't trigger re-renders
  const activeSong       = useGameStore(state => state.activeSong);
  const activeDifficulty = useGameStore(state => state.activeDifficulty);

  return (
    <div className="h-full w-full bg-game-bg">
      <GameCanvas chartData={activeSong} difficulty={activeDifficulty} />
    </div>
  );
}

export default App;
