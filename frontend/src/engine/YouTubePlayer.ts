/**
 * YouTubePlayer — thin wrapper around the YouTube IFrame Player API.
 *
 * Handles:
 *  - Dynamic loading of the YouTube IFrame API script (singleton, loads once)
 *  - Creating a YT.Player inside a given container element
 *  - Playback control (play, pause, seekTo)
 *  - Game-relative getCurrentTime() for TimingEngine sync
 *  - Player state tracking (playing / buffering / ad gaps)
 *
 * Usage:
 *   const player = new YouTubePlayer();
 *   await player.load(containerEl, videoId, segmentStart);
 *   player.onStateChange = (state) => { ... };
 *   player.play();
 *   const t = player.getCurrentTime(); // null unless state === PLAYING (1)
 */

// ── Minimal type declarations for the YouTube IFrame API ────────────────────

interface YTPlayerVars {
  autoplay?: 0 | 1;
  controls?: 0 | 1 | 2;
  disablekb?: 0 | 1;
  iv_load_policy?: 1 | 3;
  modestbranding?: 0 | 1;
  mute?: 0 | 1;
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
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void; // 0–100
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

// YT.PlayerState constants
const YT_PLAYING = 1;

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
  private _disposed = false;
  /** Current YT.PlayerState value (-1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering) */
  private _playerState = -1;
  private _fadeAnimId: number | null = null;

  /**
   * Called whenever the YouTube player state changes.
   * Receives the raw YT.PlayerState integer.
   * state === 1 means actually playing (video or ad); other values mean paused/buffering.
   */
  onStateChange?: (state: number) => void;

  /**
   * Called when the YouTube player encounters a playback error.
   * Error codes: 2=invalid ID, 5=HTML5 error, 100=not found/private,
   * 101/150=embedding disabled by the video owner.
   */
  onError?: (code: number) => void;

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
          autoplay: 1,       // kick off muted autoplay so Chrome allows later playVideo() calls
          mute: 1,           // muted — Chrome permits muted autoplay without a user gesture
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
            // Guard: if dispose() was called before onReady fired (e.g. React
            // Strict Mode double-mount teardown), bail out silently.
            if (this._disposed) return;
            // Seek to exact fractional segmentStart (start= only accepts
            // integers, so this corrects any sub-second rounding error).
            // Then pause — the autoplay: 1 above briefly played the video
            // (establishing it as "previously played" in Chrome's autoplay
            // tracker), so the later playVideo() at GO! is treated as a
            // resume rather than a new autoplay attempt.
            this._player!.seekTo(segmentStart, true);
            this._player!.pauseVideo();
            this._ready = true;
            resolve();
          },
          onStateChange: ({ data }: { data: number }) => {
            if (this._disposed) return;
            this._playerState = data;
            this.onStateChange?.(data);
          },
          onError: ({ data }: { data: number }) => {
            if (this._disposed) return;
            const descriptions: Record<number, string> = {
              2:   'Invalid video ID',
              5:   'HTML5 player error',
              100: 'Video not found or private',
              101: 'Embedding disabled by video owner',
              150: 'Embedding disabled by video owner',
            };
            console.error(
              `[YouTubePlayer] Error ${data}: ${descriptions[data] ?? 'unknown'}`,
            );
            this.onError?.(data);
          },
        },
      });
    });
  }

  /** Start playback. Call only after `load()` resolves. */
  play(): void {
    // Set volume to 0 before unmuting so there's no pop on the first frame.
    // Callers should follow this with fadeIn() to ramp up the volume.
    this._player?.setVolume(0);
    this._player?.unMute();
    this._player?.playVideo();
  }

  /**
   * Fade volume from 0 → 100 over `durationMs` milliseconds.
   * Call immediately after `play()` for a smooth start.
   */
  fadeIn(durationMs: number): void {
    if (!this._player) return;
    if (this._fadeAnimId !== null) {
      cancelAnimationFrame(this._fadeAnimId);
      this._fadeAnimId = null;
    }
    this._player.setVolume(0);
    const startTime = performance.now();
    const step = () => {
      if (this._disposed || !this._player) return;
      const t = Math.min((performance.now() - startTime) / durationMs, 1);
      this._player.setVolume(Math.round(t * 100));
      if (t < 1) {
        this._fadeAnimId = requestAnimationFrame(step);
      } else {
        this._fadeAnimId = null;
      }
    };
    this._fadeAnimId = requestAnimationFrame(step);
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
   * Returns null when the player is not yet ready OR when state is not
   * PLAYING (1) — e.g. during buffering, paused, or between ad and video.
   * Returning null tells TimingEngine to free-run its internal clock rather
   * than resyncing to a potentially wrong position.
   *
   * Note: pre-roll ads also report state=1 while playing, so getCurrentTime()
   * will return ad-relative time during ads. The TimingEngine will resync when
   * the actual video starts, correcting any drift.
   */
  getCurrentTime(): number | null {
    if (!this._ready || !this._player) return null;
    if (this._playerState !== YT_PLAYING) return null;
    return this._player.getCurrentTime() - this._segmentStart;
  }

  get isReady(): boolean {
    return this._ready;
  }

  /** True only when the player is in the PLAYING state (state === 1). */
  get isPlaying(): boolean {
    return this._playerState === YT_PLAYING;
  }

  dispose(): void {
    this._disposed = true;
    if (this._fadeAnimId !== null) {
      cancelAnimationFrame(this._fadeAnimId);
      this._fadeAnimId = null;
    }
    try {
      this._player?.destroy();
    } catch {
      // Ignore errors during teardown (e.g. if iframe was already removed)
    }
    this._player = null;
    this._ready = false;
  }
}
