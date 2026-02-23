import type { JudgmentResult, JudgmentType } from '../types';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  perfectCount: number;
  greatCount: number;
  missCount: number;
}

const SCORE_TABLE: Record<JudgmentType, number> = {
  perfect: 300,
  great: 100,
  miss: 0,
};

export function calculateAccuracy(
  perfect: number,
  great: number,
  totalNotes: number,
): number {
  if (totalNotes === 0) return 0;
  return ((perfect * 1.0 + great * 0.5) / totalNotes) * 100;
}

export function calculateGrade(accuracy: number): Grade {
  if (accuracy >= 98) return 'S';
  if (accuracy >= 90) return 'A';
  if (accuracy >= 80) return 'B';
  if (accuracy >= 70) return 'C';
  return 'D';
}

export class ScoringEngine {
  private state: ScoreState = {
    score: 0,
    combo: 0,
    maxCombo: 0,
    perfectCount: 0,
    greatCount: 0,
    missCount: 0,
  };

  processJudgment(result: JudgmentResult): ScoreState {
    this.state.score += SCORE_TABLE[result.judgment];

    if (result.judgment === 'miss') {
      this.state.combo = 0;
    } else {
      this.state.combo += 1;
      if (this.state.combo > this.state.maxCombo) {
        this.state.maxCombo = this.state.combo;
      }
    }

    if (result.judgment === 'perfect') {
      this.state.perfectCount += 1;
    } else if (result.judgment === 'great') {
      this.state.greatCount += 1;
    } else {
      this.state.missCount += 1;
    }

    return { ...this.state };
  }

  getState(): ScoreState {
    return { ...this.state };
  }

  getTotalJudged(): number {
    const { perfectCount, greatCount, missCount } = this.state;
    return perfectCount + greatCount + missCount;
  }

  getAccuracy(): number {
    const { perfectCount, greatCount } = this.state;
    return calculateAccuracy(perfectCount, greatCount, this.getTotalJudged());
  }

  getGrade(): Grade {
    return calculateGrade(this.getAccuracy());
  }

  reset(): void {
    this.state = {
      score: 0,
      combo: 0,
      maxCombo: 0,
      perfectCount: 0,
      greatCount: 0,
      missCount: 0,
    };
  }
}
