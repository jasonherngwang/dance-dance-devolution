import type { Direction, JudgmentResult, JudgmentType, Note } from '@/types';

/** Judgment window constants (milliseconds) */
export const PERFECT_WINDOW_MS = 80;
export const GREAT_WINDOW_MS = 140;

/** How often to resync clock to the audio element (milliseconds) */
const RESYNC_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/**
 * A flattened per-direction note entry.  Jump notes (Direction[]) are expanded
 * into one TrackedNote per direction so each column is tracked independently.
 */
interface TrackedNote {
  noteIndex: number;   // index in the original notes array (shared by jump arrows)
  time: number;        // seconds from segment start
  direction: Direction;
  judged: boolean;
}

// ---------------------------------------------------------------------------
// TimingEngine
// ---------------------------------------------------------------------------

/**
 * High-resolution timing engine for rhythm game judgment.
 *
 * Maintains a song clock anchored to an HTMLAudioElement (local audio) with
 * periodic resyncs every ~500ms to correct drift.  When no audio element is
 * set the clock free-runs from the moment `play()` is called.
 *
 * The `judge()` method finds the nearest unjudged arrow for a given direction
 * and assigns a Perfect (±80ms) or Great (±140ms) judgment.  Returns null if
 * no arrow is within the hit window (empty press — not penalized).
 *
 * Auto-misses (arrows that scroll past without input) are driven externally by
 * ArrowScrollManager and should be reported back via `markJudged()`.
 *
 * Usage:
 *   const engine = new TimingEngine();
 *   engine.loadNotes(chart.notes);          // once per chart load
 *   engine.setAudioElement(audioEl);         // for local audio sync
 *   engine.play();                           // start clock
 *
 *   // In game loop:
 *   const songTime = engine.getCurrentTime();
 *
 *   // On keydown (from Issue 9 input handler):
 *   const result = engine.judge(direction, performance.now());
 *   if (result) { // hit — update scoring }
 *
 *   // From ArrowScrollManager.onMiss:
 *   engine.markJudged(noteIndex, dir);
 */
export class TimingEngine {
  // ---------------------------------------------------------------------------
  // Clock model: songTime(perfNow) = _baseAudioTime + (perfNow - _basePerf) / 1000
  // ---------------------------------------------------------------------------
  private _baseAudioTime = 0;
  private _basePerf = 0;
  private _isPaused = true;
  private _pausedAt = 0;
  private _lastResyncPerf = -Infinity;

  /** Audio element for periodic resync (local audio only) */
  private _audioElement: HTMLAudioElement | null = null;

  /** Flattened, time-sorted per-direction note list */
  private _notes: TrackedNote[] = [];

  /**
   * User-configurable audio/visual sync offset in milliseconds.
   *
   * Positive values shift judgment windows later — compensates for delayed
   * audio output (e.g. Bluetooth headphones).  Applied during `judge()`.
   * Range: −200ms to +200ms.  Default: 0.
   *
   * From Issue 36; persisted via localStorage by the settings UI.
   */
  audioOffsetMs = 0;

  // ---------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------

  /**
   * Load chart notes into the engine.  Flattens jump notes (Direction[]) into
   * per-direction entries so each column is tracked independently.  Call once
   * per chart load, before `play()`.
   */
  loadNotes(notes: Note[]): void {
    this._notes = [];

    notes.forEach((note, noteIndex) => {
      const dirs = Array.isArray(note.direction) ? note.direction : [note.direction];
      for (const dir of dirs) {
        this._notes.push({
          noteIndex,
          time: note.time,
          direction: dir,
          judged: false,
        });
      }
    });

    // Sort by time — enables future binary-search optimisation and ensures
    // consistent iteration order for nearest-note lookup.
    this._notes.sort((a, b) => a.time - b.time);
  }

  /**
   * Attach an HTMLAudioElement for clock synchronisation.
   * The engine resyncs to `audio.currentTime` every ~500ms to correct drift.
   * If no element is set, the clock free-runs from `play()`.
   */
  setAudioElement(audio: HTMLAudioElement): void {
    this._audioElement = audio;
  }

  // ---------------------------------------------------------------------------
  // Clock control
  // ---------------------------------------------------------------------------

  /**
   * Start (or restart) the clock at `startTime` seconds.
   * Defaults to the audio element's `currentTime`, or 0 if none is set.
   */
  play(startTime?: number): void {
    const anchor = startTime ?? (this._audioElement?.currentTime ?? 0);
    this._baseAudioTime = anchor;
    this._basePerf = performance.now();
    this._lastResyncPerf = this._basePerf;
    this._isPaused = false;
  }

  /** Freeze the clock, recording the current song position. */
  pause(): void {
    if (!this._isPaused) {
      this._pausedAt = this.getCurrentTime();
      this._isPaused = true;
    }
  }

  /** Continue from the paused position. */
  resume(): void {
    if (this._isPaused) {
      this.play(this._pausedAt);
    }
  }

  get isPaused(): boolean {
    return this._isPaused;
  }

  // ---------------------------------------------------------------------------
  // Clock reading
  // ---------------------------------------------------------------------------

  /**
   * Returns the current song position in seconds.
   *
   * While playing, periodically resyncs to the audio element to correct drift.
   * While paused, returns the frozen position from the last `pause()` call.
   */
  getCurrentTime(): number {
    if (this._isPaused) return this._pausedAt;

    const now = performance.now();

    // Periodic resync to audio element — corrects accumulated clock drift
    if (this._audioElement && now - this._lastResyncPerf >= RESYNC_INTERVAL_MS) {
      this._baseAudioTime = this._audioElement.currentTime;
      this._basePerf = now;
      this._lastResyncPerf = now;
    }

    return this._baseAudioTime + (now - this._basePerf) / 1000;
  }

  /**
   * Convert a `performance.now()` timestamp to an estimated song position.
   * Used internally to turn keydown timestamps into song-time coordinates.
   */
  private getSongTimeAt(perfNow: number): number {
    if (this._isPaused) return this._pausedAt;
    return this._baseAudioTime + (perfNow - this._basePerf) / 1000;
  }

  // ---------------------------------------------------------------------------
  // Judgment
  // ---------------------------------------------------------------------------

  /**
   * Judge a player input for the given direction column.
   *
   * Searches for the nearest unjudged arrow in that column and, if it is
   * within the Great window (±140ms), assigns a judgment:
   *   - Perfect: |offset| ≤ 80ms
   *   - Great:   80ms < |offset| ≤ 140ms
   *
   * Returns `null` if no unjudged arrow exists within the window — the press
   * is simply ignored (no penalty).
   *
   * @param direction  - Column that was pressed (left / down / up / right)
   * @param pressTime  - `performance.now()` timestamp at the moment of keydown
   */
  judge(direction: Direction, pressTime: number): JudgmentResult | null {
    const pressTimeSong = this.getSongTimeAt(pressTime);

    let nearest: TrackedNote | null = null;
    let nearestRawOffsetMs = Infinity;

    for (const tracked of this._notes) {
      if (tracked.direction !== direction || tracked.judged) continue;

      // offsetMs > 0 → player pressed late; < 0 → pressed early
      const rawOffsetMs = (pressTimeSong - tracked.time) * 1000;

      if (Math.abs(rawOffsetMs) < Math.abs(nearestRawOffsetMs)) {
        nearest = tracked;
        nearestRawOffsetMs = rawOffsetMs;
      }
    }

    if (!nearest) return null;

    // Apply user audio offset compensation.
    // audioOffsetMs > 0 means audio output is delayed, player presses late →
    // subtract the offset so on-time presses score as Perfect.
    const correctedOffsetMs = nearestRawOffsetMs - this.audioOffsetMs;

    if (Math.abs(correctedOffsetMs) > GREAT_WINDOW_MS) {
      return null; // Arrow is outside the hit window — treat as empty press
    }

    nearest.judged = true;

    const judgment: JudgmentType =
      Math.abs(correctedOffsetMs) <= PERFECT_WINDOW_MS ? 'perfect' : 'great';

    return {
      hit: true,
      judgment,
      offsetMs: correctedOffsetMs,
      noteIndex: nearest.noteIndex,
      direction,
    };
  }

  /**
   * Externally mark a note as judged — called by ArrowScrollManager when it
   * auto-misses an arrow that scrolled past without player input.
   *
   * @param noteIndex  - Index in the original notes array
   * @param direction  - If provided, only that column is marked; otherwise all
   *                     directions sharing the noteIndex are marked (jump notes).
   */
  markJudged(noteIndex: number, direction?: Direction): void {
    for (const tracked of this._notes) {
      if (tracked.noteIndex !== noteIndex) continue;
      if (direction !== undefined && tracked.direction !== direction) continue;
      tracked.judged = true;
    }
  }

  /**
   * Reset all judgment flags without unloading notes — use when replaying the
   * same chart (e.g. demo loop restart).
   */
  resetJudgments(): void {
    for (const tracked of this._notes) {
      tracked.judged = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this._audioElement = null;
    this._notes = [];
    this._isPaused = true;
  }
}
