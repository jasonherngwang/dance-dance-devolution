import { ArrowRenderer } from './ArrowRenderer';
import { RECEPTOR_Y, COLUMN_X } from './ReceptorRenderer';
import type { Direction, Note, JudgmentType } from '@/types';

/** Base scroll speed in world-units/second at 1× multiplier.
 *  At 2× (default), arrows traverse the play field in ~2 seconds. */
export const SCROLL_BASE_SPEED = 2.25;

/** Auto-miss if the arrow is more than this many seconds past the receptor */
const MISS_WINDOW_S = 0.14;

/** Fade-out duration in ms after a hit or auto-miss */
const FADE_DURATION_MS = 280;

/** Y below which the viewport is not visible (screen bottom ≈ −5.0, buffer = 0.2) */
const SPAWN_Y = -5.2;

interface ActiveArrow {
  /** Index into the loaded notes array — shared by all arrows in a jump */
  noteIndex: number;
  dir: Direction;
  /** Slot in ArrowRenderer's per-direction pool */
  instanceId: number;
  /** When this arrow should reach the receptor (seconds) */
  noteTime: number;
  /** Whether a judgment (hit or miss) has been assigned */
  judged: boolean;
  /** True when auto-missed by the scroll system */
  missed: boolean;
  /** performance.now() when fade started; -1 = not fading yet */
  fadeStartMs: number;
}

/**
 * Manages the full arrow lifecycle: spawn → scroll → judge/despawn.
 *
 * Usage:
 *   const mgr = new ArrowScrollManager(arrowRenderer);
 *   mgr.loadChart(chart.notes);
 *   mgr.onMiss = (noteIndex, dir) => scoringEngine.recordMiss(noteIndex, dir);
 *
 *   // In the game loop (call BEFORE arrowRenderer.update()):
 *   mgr.update(currentSongTimeSeconds);
 *   arrowRenderer.update(); // flush dirty instances to GPU
 *
 *   // When the timing engine registers a player hit:
 *   mgr.judgeArrow(noteIndex, 'perfect');
 */
export class ArrowScrollManager {
  private readonly renderer: ArrowRenderer;
  private notes: Note[] = [];
  /** Index of the next note to consider for spawning */
  private nextNoteIndex = 0;
  private activeArrows: ActiveArrow[] = [];

  /** DDR-style scroll speed multiplier (1 = slowest). Default 2× */
  scrollMultiplier = 2;

  /** Fired when an arrow scrolls past the step zone without being hit */
  onMiss?: (noteIndex: number, dir: Direction) => void;

  constructor(renderer: ArrowRenderer) {
    this.renderer = renderer;
  }

  // ---------------------------------------------------------------------------
  // Chart loading
  // ---------------------------------------------------------------------------

  /** Load (or reload) a chart. Resets all scroll state. */
  loadChart(notes: Note[]): void {
    // Ensure chronological order
    this.notes = [...notes].sort((a, b) => a.time - b.time);
    this.reset();
  }

  /** Release all active arrows back to the pool and reset counters. */
  reset(): void {
    for (const arrow of this.activeArrows) {
      this.renderer.release(arrow.dir, arrow.instanceId);
    }
    this.activeArrows = [];
    this.nextNoteIndex = 0;
  }

  // ---------------------------------------------------------------------------
  // External judgment (called by timing engine on player input)
  // ---------------------------------------------------------------------------

  /**
   * Mark the note at `noteIndex` as judged by the player.
   * All arrows sharing that noteIndex (jump arrows) are faded out together.
   */
  judgeArrow(noteIndex: number, judgment: JudgmentType): void {
    const now = performance.now();
    for (const arrow of this.activeArrows) {
      if (arrow.noteIndex === noteIndex && !arrow.judged) {
        arrow.judged = true;
        arrow.missed = judgment === 'miss';
        arrow.fadeStartMs = now;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * Update arrow positions and handle spawning, auto-miss, and fade-out.
   *
   * Call once per frame with the current song position **before** calling
   * `arrowRenderer.update()`.  Does NOT flush to GPU itself.
   *
   * @param currentTime - current song position in seconds
   */
  update(currentTime: number): void {
    const scrollSpeed = this.scrollMultiplier * SCROLL_BASE_SPEED;
    const now = performance.now();

    // How far ahead (in seconds) to start the arrow lifecycle — enough time
    // for the arrow to travel from SPAWN_Y to RECEPTOR_Y.
    const viewAheadS = (RECEPTOR_Y - SPAWN_Y) / scrollSpeed;

    // -------------------------------------------------------------------------
    // 1. Spawn arrows that have entered the approach window
    // -------------------------------------------------------------------------
    while (this.nextNoteIndex < this.notes.length) {
      const note = this.notes[this.nextNoteIndex];

      // Not yet in range — stop scanning (notes are sorted)
      if (note.time - currentTime > viewAheadS) break;

      // Already past the miss window — skip without spawning
      if (note.time < currentTime - MISS_WINDOW_S) {
        this.nextNoteIndex++;
        continue;
      }

      // Spawn one arrow per direction (handles single arrows and jumps)
      const dirs = Array.isArray(note.direction) ? note.direction : [note.direction];
      for (const dir of dirs) {
        const id = this.renderer.allocate(dir);
        if (id < 0) {
          console.warn('[ArrowScrollManager] Pool exhausted for direction:', dir);
          continue;
        }
        this.activeArrows.push({
          noteIndex: this.nextNoteIndex,
          dir,
          instanceId: id,
          noteTime: note.time,
          judged: false,
          missed: false,
          fadeStartMs: -1,
        });
      }

      this.nextNoteIndex++;
    }

    // -------------------------------------------------------------------------
    // 2. Update each active arrow (iterate in reverse for safe splice)
    // -------------------------------------------------------------------------
    for (let i = this.activeArrows.length - 1; i >= 0; i--) {
      const arrow = this.activeArrows[i];

      // Y position: at noteTime the arrow is exactly at RECEPTOR_Y; below before.
      const timeDelta = arrow.noteTime - currentTime;
      const y = RECEPTOR_Y - timeDelta * scrollSpeed;
      const x = COLUMN_X[arrow.dir];

      // Auto-miss: arrow scrolled past the hit window with no player input
      if (!arrow.judged && currentTime > arrow.noteTime + MISS_WINDOW_S) {
        arrow.judged = true;
        arrow.missed = true;
        arrow.fadeStartMs = now;
        this.onMiss?.(arrow.noteIndex, arrow.dir);
      }

      // Fade-out phase (hit or missed)
      if (arrow.fadeStartMs >= 0) {
        const t = Math.min((now - arrow.fadeStartMs) / FADE_DURATION_MS, 1.0);

        if (t >= 1.0) {
          // Fully faded — release to pool and remove from active list
          this.renderer.release(arrow.dir, arrow.instanceId);
          this.activeArrows.splice(i, 1);
          continue;
        }

        // Slide slightly upward while fading for visual polish
        this.renderer.setPosition(arrow.dir, arrow.instanceId, x, y + t * 0.3);
        this.renderer.setOpacity(arrow.dir, arrow.instanceId, 1.0 - t);
        continue;
      }

      // Active arrow — position based on song time; hide if outside visible range
      const inView = y >= SPAWN_Y - 0.5 && y <= RECEPTOR_Y + 1.0;
      if (inView) {
        this.renderer.setPosition(arrow.dir, arrow.instanceId, x, y);
        this.renderer.setOpacity(arrow.dir, arrow.instanceId, 1.0);
      } else {
        // Outside viewport — park off-screen (opacity 0 = invisible in additive blend)
        this.renderer.setOpacity(arrow.dir, arrow.instanceId, 0);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------------

  /** Number of arrows currently live (not yet judged or fading) */
  get liveArrowCount(): number {
    return this.activeArrows.filter(a => !a.judged).length;
  }

  /** Total active arrows including those currently fading out */
  get totalActiveCount(): number {
    return this.activeArrows.length;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this.reset();
  }
}
