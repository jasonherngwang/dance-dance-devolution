import { create } from 'zustand';
import type { ChartData, Difficulty, JudgmentResult, GameResult } from '../types';

export type Screen = 'home' | 'select' | 'loading' | 'gameplay' | 'results';
export type GameState = 'idle' | 'countdown' | 'playing' | 'ended';

interface GameStore {
  // Navigation
  screen: Screen;
  setScreen: (screen: Screen) => void;

  // Active song/difficulty selection
  activeSong: ChartData | null;
  activeDifficulty: Difficulty;
  setActiveSong: (song: ChartData, difficulty: Difficulty) => void;

  // Game state
  gameState: GameState;
  startCountdown: () => void;
  startPlaying: () => void;
  endGame: () => void;

  // Score / combo
  score: number;
  combo: number;
  maxCombo: number;
  perfectCount: number;
  greatCount: number;
  missCount: number;
  processJudgment: (result: JudgmentResult) => void;

  // Final result (set when game ends)
  gameResult: GameResult | null;
  setGameResult: (result: GameResult) => void;

  // Reset all game state for a new session
  resetGame: () => void;
}

const defaultGameState: Pick<
  GameStore,
  | 'gameState'
  | 'score'
  | 'combo'
  | 'maxCombo'
  | 'perfectCount'
  | 'greatCount'
  | 'missCount'
  | 'gameResult'
> = {
  gameState: 'idle',
  score: 0,
  combo: 0,
  maxCombo: 0,
  perfectCount: 0,
  greatCount: 0,
  missCount: 0,
  gameResult: null,
};

export const useGameStore = create<GameStore>((set, get) => ({
  // Navigation
  screen: 'home',
  setScreen: (screen) => set({ screen }),

  // Active song/difficulty selection
  activeSong: null,
  activeDifficulty: 'easy',
  setActiveSong: (song, difficulty) =>
    set({ activeSong: song, activeDifficulty: difficulty }),

  // Game state
  ...defaultGameState,
  startCountdown: () => set({ gameState: 'countdown' }),
  startPlaying: () => set({ gameState: 'playing' }),
  endGame: () => set({ gameState: 'ended' }),

  // Score / combo
  processJudgment: (result) => {
    const { score, combo, maxCombo, perfectCount, greatCount, missCount } = get();
    let newScore = score;
    let newCombo = combo;
    let newPerfect = perfectCount;
    let newGreat = greatCount;
    let newMiss = missCount;

    if (result.judgment === 'perfect') {
      newScore += 300;
      newCombo += 1;
      newPerfect += 1;
    } else if (result.judgment === 'great') {
      newScore += 100;
      newCombo += 1;
      newGreat += 1;
    } else {
      newCombo = 0;
      newMiss += 1;
    }

    set({
      score: newScore,
      combo: newCombo,
      maxCombo: Math.max(maxCombo, newCombo),
      perfectCount: newPerfect,
      greatCount: newGreat,
      missCount: newMiss,
    });
  },

  // Final result
  setGameResult: (result) => set({ gameResult: result }),

  // Reset for a new session
  resetGame: () => set(defaultGameState),
}));
