import type { Direction } from '@/types';

// ---------------------------------------------------------------------------
// Key → Direction mapping
// ---------------------------------------------------------------------------

/**
 * Maps keyboard keys to game directions.
 *
 * DFJK layout: D=Left, F=Down, J=Up, K=Right
 * Arrow keys:  ArrowLeft, ArrowDown, ArrowUp, ArrowRight
 */
const KEY_MAP: Record<string, Direction> = {
  // Arrow keys
  ArrowLeft:  'left',
  ArrowDown:  'down',
  ArrowUp:    'up',
  ArrowRight: 'right',
  // DFJK layout (mirrors typical DDR hand/foot placement)
  KeyD: 'left',
  KeyF: 'down',
  KeyJ: 'up',
  KeyK: 'right',
};

/** Arrow key codes — these get preventDefault() to block page scrolling */
const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowRight']);

// ---------------------------------------------------------------------------
// InputHandler
// ---------------------------------------------------------------------------

/**
 * Keyboard input handler for rhythm game input.
 *
 * Listens for `keydown` events on the window, maps arrow keys and DFJK to
 * game directions, and fires an `onInput` callback with the direction and the
 * precise `performance.now()` timestamp captured at keydown.
 *
 * Features:
 * - Ignores auto-repeated events (`event.repeat`)
 * - Calls `event.preventDefault()` on arrow keys to prevent page scrolling
 * - Input can be enabled/disabled at runtime (e.g. during countdown, results)
 *
 * Usage:
 *   const input = new InputHandler();
 *   input.onInput = (direction, timestamp) => {
 *     const result = timingEngine.judge(direction, timestamp);
 *     // ...
 *   };
 *   input.enable();
 *
 *   // During countdown or results:
 *   input.disable();
 *
 *   // On unmount:
 *   input.dispose();
 */
export class InputHandler {
  /**
   * Called whenever a valid game key is pressed.
   *
   * @param direction  - The game direction (left / down / up / right)
   * @param timestamp  - `performance.now()` value captured at the keydown event
   */
  onInput: ((direction: Direction, timestamp: number) => void) | null = null;

  private _enabled = false;
  private _boundHandler: (e: KeyboardEvent) => void;

  constructor() {
    // Bind once so we can remove the exact same reference in dispose()
    this._boundHandler = this._handleKeyDown.bind(this);
    window.addEventListener('keydown', this._boundHandler);
  }

  // ---------------------------------------------------------------------------
  // Enable / disable
  // ---------------------------------------------------------------------------

  /** Allow input callbacks to fire. */
  enable(): void {
    this._enabled = true;
  }

  /** Suppress input callbacks (handler still attached to prevent scroll). */
  disable(): void {
    this._enabled = false;
  }

  get isEnabled(): boolean {
    return this._enabled;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _handleKeyDown(e: KeyboardEvent): void {
    // Always prevent arrow-key page scrolling, even when input is disabled
    if (ARROW_KEYS.has(e.code)) {
      e.preventDefault();
    }

    // Ignore key-repeat events (key held down)
    if (e.repeat) return;

    // Look up the direction for this key
    const direction = KEY_MAP[e.code];
    if (!direction) return;

    // Capture timestamp before any other processing
    const timestamp = performance.now();

    if (this._enabled && this.onInput) {
      this.onInput(direction, timestamp);
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  /** Remove the event listener. Call when the game component unmounts. */
  dispose(): void {
    window.removeEventListener('keydown', this._boundHandler);
    this.onInput = null;
    this._enabled = false;
  }
}
