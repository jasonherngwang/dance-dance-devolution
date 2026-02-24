/**
 * AudioPlayer — manages local audio playback via HTMLAudioElement.
 *
 * Handles:
 *  - Loading audio from a URL and seeking to segment_start
 *  - AudioContext creation on first `play()` call, satisfying browser autoplay
 *    policy (AudioContext must be created inside a user-gesture handler)
 *  - Exposing `element` for TimingEngine.setAudioElement() sync
 *  - `getCurrentTime()` normalised to game-relative time (0 = segment_start)
 *
 * Usage:
 *   const player = new AudioPlayer();
 *   await player.load('/audio/song.mp3', 12.5); // load & seek to 12.5s
 *   // ... on first user gesture (keydown / touchstart) ...
 *   await player.play();
 *   timingEngine.setAudioElement(player.element);
 */
export class AudioPlayer {
  private readonly _audio: HTMLAudioElement;
  private _audioContext: AudioContext | null = null;
  private _segmentStart = 0;
  private _isLoaded = false;
  private _disposed = false;
  private _fadeAnimId: number | null = null;

  constructor() {
    this._audio = new Audio();
    this._audio.preload = 'auto';
    // Required for iOS Safari to allow inline audio
    this._audio.setAttribute('playsinline', '');
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Load an audio file and seek to `segmentStart`.
   *
   * Returns a Promise that resolves when enough data has buffered to begin
   * playback (`canplaythrough`).  Rejects with an Error if the file cannot
   * be loaded.
   *
   * @param url           Path to the audio file (e.g. `/audio/sandstorm.mp3`)
   * @param segmentStart  Offset in seconds within the file where gameplay
   *                      begins.  `getCurrentTime()` returns positions
   *                      relative to this point.
   */
  load(url: string, segmentStart = 0): Promise<void> {
    this._segmentStart = segmentStart;
    this._isLoaded = false;

    this._audio.src = url;

    return new Promise<void>((resolve, reject) => {
      const onCanPlay = () => {
        // Seek after the browser has loaded enough metadata.
        // Using 'canplay' (not 'canplaythrough') because Chrome defers
        // 'canplaythrough' indefinitely for files served without Accept-Ranges
        // support, causing the load Promise to never resolve.
        this._audio.currentTime = segmentStart;
        this._isLoaded = true;
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        // Silently resolve if the error was triggered by dispose() clearing audio.src —
        // this is expected in React Strict Mode where effects are double-invoked.
        if (this._disposed) { resolve(); return; }
        reject(new Error(`AudioPlayer: failed to load "${url}"`));
      };

      const cleanup = () => {
        this._audio.removeEventListener('canplay', onCanPlay);
        this._audio.removeEventListener('error', onError);
      };

      this._audio.addEventListener('canplay', onCanPlay);
      this._audio.addEventListener('error', onError);
      this._audio.load();
    });
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  /**
   * Pre-create the AudioContext and wire up the media element source graph.
   *
   * Call this early (e.g. at the start of the countdown) so the synchronous
   * AudioContext construction and createMediaElementSource() work happens well
   * before gameplay begins, preventing a frame stall at the GO! transition.
   *
   * Safe to call multiple times — only creates the context once.
   */
  prewarm(): void {
    if (this._audioContext) return;
    this._audioContext = new AudioContext();
    const source = this._audioContext.createMediaElementSource(this._audio);
    source.connect(this._audioContext.destination);
  }

  /**
   * Start playback.
   *
   * Resumes the AudioContext if suspended (created by prewarm()), then calls
   * audio.play().  If prewarm() was not called first, falls back to creating
   * the context here.
   *
   * Returns the AudioContext's play Promise so callers can catch NotAllowedError
   * if the gesture requirement is not met.
   */
  async play(): Promise<void> {
    this.prewarm();

    if (this._audioContext!.state === 'suspended') {
      await this._audioContext!.resume();
    }

    await this._audio.play();
  }

  /** Pause playback. */
  pause(): void {
    this._audio.pause();
  }

  /**
   * Fade volume from 0 → 1 over `durationMs` milliseconds.
   * Call immediately after `play()` for a smooth start.
   */
  fadeIn(durationMs: number): void {
    if (this._fadeAnimId !== null) {
      cancelAnimationFrame(this._fadeAnimId);
      this._fadeAnimId = null;
    }
    this._audio.volume = 0;
    const startTime = performance.now();
    const step = () => {
      if (this._disposed) return;
      const t = Math.min((performance.now() - startTime) / durationMs, 1);
      this._audio.volume = t;
      if (t < 1) {
        this._fadeAnimId = requestAnimationFrame(step);
      } else {
        this._fadeAnimId = null;
      }
    };
    this._fadeAnimId = requestAnimationFrame(step);
  }

  /**
   * Seek to a game-relative position in seconds.
   *
   * `gameTime = 0` seeks to `segmentStart` in the underlying file.
   */
  seek(gameTime: number): void {
    this._audio.currentTime = this._segmentStart + gameTime;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /**
   * Current playback position relative to `segmentStart` (in seconds).
   *
   * Equivalent to `audio.currentTime - segmentStart`.
   */
  getCurrentTime(): number {
    return this._audio.currentTime - this._segmentStart;
  }

  get segmentStart(): number {
    return this._segmentStart;
  }

  get isLoaded(): boolean {
    return this._isLoaded;
  }

  get isPlaying(): boolean {
    return !this._audio.paused;
  }

  /**
   * The underlying HTMLAudioElement.
   *
   * Pass this to `TimingEngine.setAudioElement()` so the timing engine can
   * resync its clock to the real audio position every ~500 ms.
   *
   * NOTE: TimingEngine reads `audio.currentTime` directly and must subtract
   * `segmentStart` itself — set `timingEngine.segmentStart` to match.
   */
  get element(): HTMLAudioElement {
    return this._audio;
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  dispose(): void {
    this._disposed = true;
    if (this._fadeAnimId !== null) {
      cancelAnimationFrame(this._fadeAnimId);
      this._fadeAnimId = null;
    }
    this._audio.pause();
    this._audio.src = '';
    if (this._audioContext) {
      this._audioContext.close().catch(() => undefined);
      this._audioContext = null;
    }
    this._isLoaded = false;
  }
}
