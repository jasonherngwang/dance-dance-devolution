import type { Difficulty, Direction } from './chart';

export type JudgmentType = 'perfect' | 'great' | 'miss';

export interface JudgmentResult {
  hit: boolean;
  judgment: JudgmentType;
  offsetMs: number;   // positive = late, negative = early
  noteIndex: number;
  direction: Direction;
}

export interface GameResult {
  video_id: string;
  difficulty: Difficulty;
  score: number;
  perfect: number;
  great: number;
  miss: number;
  maxCombo: number;
  accuracy: number;   // 0-100%
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
}
