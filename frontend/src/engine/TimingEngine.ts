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

  /**
   * Generic time source for non-audio sync (e.g. YouTube IFrame player).
   * Function returns game-relative seconds (segmentStart already subtracted),
   * or null if the source is not yet ready.
   *
   * Takes priority over _audioElement when set.
   */
  private _timeSource: (() => number | null) | null = null;

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

  /**
   * Additional leniency (milliseconds) added to both judgment windows for
   * touch input devices.  Set to 30 on touch devices to compensate for
   * the higher latency inherent in capacitive touch vs. mechanical keys.
   *
   * Applied symmetrically: Perfect window becomes ±(80+touchWindowBonus)ms,
   * Great window becomes ±(140+touchWindowBonus)ms.  Default: 0.
   */
  touchWindowBonus = 0;

  /**
   * Segment start offset in seconds.
   *
   * When an audio file has `segment_start > 0`, the audio element's
   * `currentTime` begins at that offset rather than 0.  This value is
   * subtracted during periodic resyncs so that `getCurrentTime()` always
   * returns a game-relative position (0 = start of the playable segment).
   *
   * Set this before calling `setAudioElement()` / `play()`.  Default: 0.
   */
  segmentStart = 0;

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

  /**
   * Set a generic time source for clock synchronisation.
   *
   * Used for YouTube IFrame playback where no HTMLAudioElement is available.
   * The function must return game-relative seconds (segmentStart already
   * subtracted), or null if the source is not yet ready — the engine will
   * skip that resync cycle and try again at the next interval.
   *
   * Takes priority over setAudioElement() when both are set.
   * Pass null to clear and fall back to audio element sync.
   */
  setTimeSource(fn: (() => number | null) | null): void {
    this._timeSource = fn;
  }

  // ---------------------------------------------------------------------------
  // Clock control
  // ---------------------------------------------------------------------------

  /**
   * Start (or restart) the clock at `startTime` seconds.
   *
   * If `startTime` is omitted and an audio element is attached, anchors to
   * the normalised audio position (`audio.currentTime - segmentStart`).
   * Falls back to 0 if no audio element is set.
   */
  play(startTime?: number): void {
    const anchor =
      startTime ??
      (this._audioElement
        ? this._audioElement.currentTime - this.segmentStart
        : 0);
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
   * While playing, periodically resyncs to the audio source to correct drift.
   * Only corrects forward (never backward) to prevent visible arrow jumps.
   * While paused, returns the frozen position from the last `pause()` call.
   */
  getCurrentTime(): number {
    if (this._isPaused) return this._pausedAt;

    const now = performance.now();
    const freeRunning = this._baseAudioTime + (now - this._basePerf) / 1000;

    // Periodic resync — corrects accumulated clock drift.
    // _timeSource (YouTube) takes priority over _audioElement (local audio).
    if (now - this._lastResyncPerf >= RESYNC_INTERVAL_MS) {
      let audioTime: number | null = null;

      if (this._timeSource) {
        audioTime = this._timeSource();
      } else if (this._audioElement) {
        audioTime = this._audioElement.currentTime - this.segmentStart;
      }

      if (audioTime !== null) {
        this._lastResyncPerf = now;
        const drift = audioTime - freeRunning; // negative = clock ahead

        if (drift > 0.5) {
          // Large forward jump needed — snap (e.g. after a seek)
          this._baseAudioTime = audioTime;
          this._basePerf = now;
          return audioTime;
        }

        if (drift > 0) {
          // Clock behind audio — nudge forward (less visually jarring)
          const corrected = freeRunning + drift * 0.5;
          this._baseAudioTime = corrected;
          this._basePerf = now;
          return corrected;
        }

        // drift <= 0: clock ahead of audio — don't correct backward.
        // Preserves smooth arrow scrolling. The offset (typically <100ms
        // from audio startup delay) is imperceptible and within judgment
        // windows (±80ms Perfect, ±140ms Great).
      }
    }

    return freeRunning;
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

    const effectivePerfect = PERFECT_WINDOW_MS + this.touchWindowBonus;
    const effectiveGreat   = GREAT_WINDOW_MS   + this.touchWindowBonus;

    // Binary search: find the first note whose time >= (pressTime - window).
    // Include audioOffsetMs headroom so notes near the edge are never skipped.
    const windowS = (effectiveGreat + Math.abs(this.audioOffsetMs)) / 1000;
    const lo = pressTimeSong - windowS;
    const hi = pressTimeSong + windowS;

    let left = 0;
    let right = this._notes.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (this._notes[mid].time < lo) left = mid + 1;
      else right = mid;
    }

    let nearest: TrackedNote | null = null;
    let nearestRawOffsetMs = Infinity;

    // Linear scan only over notes within the ±window slice (typically 1-4 notes)
    for (let i = left; i < this._notes.length; i++) {
      const tracked = this._notes[i];
      if (tracked.time > hi) break;
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

    if (Math.abs(correctedOffsetMs) > effectiveGreat) {
      return null; // Arrow is outside the hit window — treat as empty press
    }

    nearest.judged = true;

    const judgment: JudgmentType =
      Math.abs(correctedOffsetMs) <= effectivePerfect ? 'perfect' : 'great';

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
    this._timeSource = null;
    this._notes = [];
    this._isPaused = true;
  }
}
