/**
 * YouTubePlayer — thin wrapper around the YouTube IFrame Player API.
 *
 * Handles:
 *  - Dynamic loading of the YouTube IFrame API script (singleton, loads once)
 *  - Creating a YT.Player inside a given container element
 *  - Playback control (play, pause, seekTo)
 *  - Game-relative getCurrentTime() for TimingEngine sync
 *
 * Usage:
 *   const player = new YouTubePlayer();
 *   await player.load(containerEl, videoId, segmentStart);
 *   player.play();
 *   const t = player.getCurrentTime(); // null until ready
 */

// ── Minimal type declarations for the YouTube IFrame API ────────────────────

interface YTPlayerVars {
  autoplay?: 0 | 1;
  controls?: 0 | 1 | 2;
  disablekb?: 0 | 1;
  iv_load_policy?: 1 | 3;
  modestbranding?: 0 | 1;
  rel?: 0 | 1;
  start?: number;
  playsinline?: 0 | 1;
}

interface YTPlayerOptions {
  videoId?: string;
  width?: number | string;
  height?: number | string;
  playerVars?: YTPlayerVars;
  events?: {
    onReady?: (event: { target: YTPlayerInstance }) => void;
    onStateChange?: (event: { data: number }) => void;
    onError?: (event: { data: number }) => void;
  };
}

interface YTPlayerInstance {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  destroy(): void;
}

interface YTNamespace {
  Player: new (container: HTMLElement, options: YTPlayerOptions) => YTPlayerInstance;
}

declare global {
  interface Window {
    YT: YTNamespace;
    onYouTubeIframeAPIReady: () => void;
  }
}

// ── Singleton API loader ─────────────────────────────────────────────────────

/**
 * The YouTube IFrame API script only needs to be injected once per page.
 * Subsequent calls return the same Promise.
 */
let _apiReady = false;
let _apiPromise: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (_apiReady) return Promise.resolve();
  if (_apiPromise) return _apiPromise;

  _apiPromise = new Promise<void>((resolve) => {
    // Chain with any existing callback so multiple consumers can coexist
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      _apiReady = true;
      if (typeof prev === 'function') prev();
      resolve();
    };

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  });

  return _apiPromise;
}

// ── YouTubePlayer ────────────────────────────────────────────────────────────

export class YouTubePlayer {
  private _player: YTPlayerInstance | null = null;
  private _segmentStart = 0;
  private _ready = false;

  /**
   * Load the YouTube IFrame API (if not already done) and mount a player
   * inside `container` for the given `videoId`.
   *
   * Resolves when the player is ready and seeked to `segmentStart`.
   * The container element is replaced by the YouTube iframe.
   *
   * @param container     DOM element to mount the iframe into
   * @param videoId       YouTube video ID (11-character string)
   * @param segmentStart  Absolute video time (seconds) where gameplay begins
   */
  async load(container: HTMLElement, videoId: string, segmentStart = 0): Promise<void> {
    this._segmentStart = segmentStart;
    await loadYouTubeAPI();

    await new Promise<void>((resolve) => {
      this._player = new window.YT.Player(container, {
        videoId,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,       // hide native controls
          disablekb: 1,      // disable YouTube keyboard shortcuts
          iv_load_policy: 3, // no video annotations
          modestbranding: 1, // minimal YouTube branding
          rel: 0,            // no related videos at end
          start: Math.floor(segmentStart), // integer approximation (seek done in onReady)
          playsinline: 1,    // iOS inline playback
        },
        events: {
          onReady: () => {
            // Seek to exact fractional segmentStart (start= only accepts integers)
            this._player!.seekTo(segmentStart, true);
            this._player!.pauseVideo();
            this._ready = true;
            resolve();
          },
        },
      });
    });
  }

  /** Start playback. Call only after `load()` resolves. */
  play(): void {
    this._player?.playVideo();
  }

  /** Pause playback. */
  pause(): void {
    this._player?.pauseVideo();
  }

  /**
   * Seek to a game-relative position (0 = segment start).
   * Maps game time → absolute video time by adding segmentStart.
   */
  seekTo(gameTime: number): void {
    this._player?.seekTo(this._segmentStart + gameTime, true);
  }

  /**
   * Returns game-relative current time in seconds:
   *   player.getCurrentTime() - segmentStart
   *
   * Returns null when the player is not yet ready.
   */
  getCurrentTime(): number | null {
    if (!this._ready || !this._player) return null;
    return this._player.getCurrentTime() - this._segmentStart;
  }

  get isReady(): boolean {
    return this._ready;
  }

  dispose(): void {
    try {
      this._player?.destroy();
    } catch {
      // Ignore errors during teardown (e.g. if iframe was already removed)
    }
    this._player = null;
    this._ready = false;
  }
}
