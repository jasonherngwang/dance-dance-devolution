import { create } from 'zustand';
import type { ChartData, Difficulty, JudgmentResult, GameResult } from '../types';
import { ScoringEngine } from '../engine/ScoringEngine';

export type Screen = 'home' | 'select' | 'loading' | 'gameplay' | 'results';
export type GameState = 'idle' | 'countdown' | 'playing' | 'ended';

// Module-level engine instance; reset on each new game session
const _engine = new ScoringEngine();

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

  // Score / combo (reactive state synced from ScoringEngine)
  score: number;
  combo: number;
  maxCombo: number;
  perfectCount: number;
  greatCount: number;
  missCount: number;
  processJudgment: (result: JudgmentResult) => void;

  // Compute a GameResult from current scoring state
  computeGameResult: () => GameResult;

  // Final result (set when game ends)
  gameResult: GameResult | null;
  setGameResult: (result: GameResult) => void;

  // Reset all game state for a new session
  resetGame: () => void;
}

const defaultScoreState = {
  gameState: 'idle' as GameState,
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
  ...defaultScoreState,
  startCountdown: () => set({ gameState: 'countdown' }),
  startPlaying: () => set({ gameState: 'playing' }),
  endGame: () => set({ gameState: 'ended' }),

  // Score / combo — delegate to ScoringEngine, sync result to reactive store
  processJudgment: (result) => {
    const state = _engine.processJudgment(result);
    set({
      score: state.score,
      combo: state.combo,
      maxCombo: state.maxCombo,
      perfectCount: state.perfectCount,
      greatCount: state.greatCount,
      missCount: state.missCount,
    });
  },

  // Build a complete GameResult from current engine state
  computeGameResult: () => {
    const { activeSong, activeDifficulty } = get();
    const state = _engine.getState();
    const accuracy = _engine.getAccuracy();
    const grade = _engine.getGrade();
    return {
      video_id: activeSong?.video_id ?? '',
      difficulty: activeDifficulty,
      score: state.score,
      perfect: state.perfectCount,
      great: state.greatCount,
      miss: state.missCount,
      maxCombo: state.maxCombo,
      accuracy,
      grade,
    };
  },

  // Final result
  setGameResult: (result) => set({ gameResult: result }),

  // Reset for a new session
  resetGame: () => {
    _engine.reset();
    set(defaultScoreState);
  },
}));
