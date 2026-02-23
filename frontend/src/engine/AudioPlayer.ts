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
        // Seek after the browser has loaded enough metadata
        this._audio.currentTime = segmentStart;
        this._isLoaded = true;
        cleanup();
        resolve();
      };

      const onError = () => {
        cleanup();
        reject(new Error(`AudioPlayer: failed to load "${url}"`));
      };

      const cleanup = () => {
        this._audio.removeEventListener('canplaythrough', onCanPlay);
        this._audio.removeEventListener('error', onError);
      };

      this._audio.addEventListener('canplaythrough', onCanPlay);
      this._audio.addEventListener('error', onError);
      this._audio.load();
    });
  }

  // ---------------------------------------------------------------------------
  // Playback control
  // ---------------------------------------------------------------------------

  /**
   * Start playback.
   *
   * Creates an AudioContext the first time this is called (browser autoplay
   * policy requires the AudioContext to be created inside a user-gesture
   * handler such as `keydown` or `touchstart`).  Resumes a suspended context
   * if needed, then calls `audio.play()`.
   *
   * Returns the AudioContext's play Promise so callers can catch NotAllowedError
   * if the gesture requirement is not met.
   */
  async play(): Promise<void> {
    if (!this._audioContext) {
      this._audioContext = new AudioContext();
      const source = this._audioContext.createMediaElementSource(this._audio);
      source.connect(this._audioContext.destination);
    }

    if (this._audioContext.state === 'suspended') {
      await this._audioContext.resume();
    }

    await this._audio.play();
  }

  /** Pause playback. */
  pause(): void {
    this._audio.pause();
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
    this._audio.pause();
    this._audio.src = '';
    if (this._audioContext) {
      this._audioContext.close().catch(() => undefined);
      this._audioContext = null;
    }
    this._isLoaded = false;
  }
}
