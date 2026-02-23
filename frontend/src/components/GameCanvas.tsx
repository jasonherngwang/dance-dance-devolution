import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { ArrowRenderer } from '@/rendering/ArrowRenderer';
import { ReceptorRenderer } from '@/rendering/ReceptorRenderer';
import { ArrowScrollManager } from '@/rendering/ArrowScrollManager';
import { HitEffectRenderer } from '@/rendering/HitEffectRenderer';
import { BackgroundRenderer } from '@/rendering/BackgroundRenderer';
import { PostProcessingManager } from '@/rendering/PostProcessingManager';
import { TimingEngine } from '@/engine/TimingEngine';
import { AudioPlayer } from '@/engine/AudioPlayer';
import { YouTubePlayer } from '@/engine/YouTubePlayer';
import { InputHandler } from '@/engine/InputHandler';
import { TouchInputZones } from './TouchInputZones';
import { JudgmentDisplay } from './JudgmentDisplay';
import { ComboDisplay, getHypeLevel } from './ComboDisplay';
import { HypeOverlay } from './HypeOverlay';
import { ScreenEffects } from './ScreenEffects';
import { GameplayHUD } from './GameplayHUD';
import { CountdownOverlay } from './CountdownOverlay';
import type { CountdownPhase } from './CountdownOverlay';
import { useGameStore } from '@/stores';
import type { ChartData, Difficulty, Direction, JudgmentResult, JudgmentType, Note } from '@/types';

/** Detect touch-primary devices */
function isTouchDevice(): boolean {
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu !== null;
}

// ---------------------------------------------------------------------------
// Demo chart — used when no real chart data is provided
// ---------------------------------------------------------------------------
const DEMO_DURATION = 16; // seconds before looping
const DEMO_BPM = 120;
const DEMO_DIRS: Direction[] = ['left', 'down', 'up', 'right'];

function buildDemoNotes(): Note[] {
  const notes: Note[] = [];
  for (let i = 0; i * 0.5 < DEMO_DURATION; i++) {
    notes.push({
      time: i * 0.5,
      type: 'tap',
      direction: DEMO_DIRS[i % DEMO_DIRS.length],
    });
  }
  // A few jumps at every 4-note boundary
  for (let i = 4; i * 0.5 < DEMO_DURATION; i += 8) {
    notes.push({
      time: i * 0.5,
      type: 'tap',
      direction: ['left', 'right'],
    });
  }
  return notes.sort((a, b) => a.time - b.time);
}

const DEMO_NOTES = buildDemoNotes();

/** Total judgeable direction slots for a note list (flattened). */
function countJudgeableNotes(notes: Note[]): number {
  return notes.reduce(
    (acc, note) => acc + (Array.isArray(note.direction) ? note.direction.length : 1),
    0,
  );
}

// Combo milestones that trigger chromatic-aberration flash
const COMBO_MILESTONES = [25, 50, 100];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GameCanvasProps {
  /** Real chart data from the store; null = show demo loop */
  chartData: ChartData | null;
  /** Difficulty to play; ignored when chartData is null */
  difficulty: Difficulty;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GameCanvas({ chartData, difficulty }: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Container for the YouTube iframe (YouTube source only)
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const webGPUSupported = isWebGPUAvailable();

  // Mobile touch detection — stable across renders
  const isMobile = isTouchDevice();

  // Whether touch input is currently enabled (matches game state)
  const [touchInputEnabled, setTouchInputEnabled] = useState(!chartData);

  // Shared input handler ref so TouchInputZones can use the same callback
  const inputHandlerCallbackRef = useRef<((direction: Direction, timestamp: number) => void) | null>(null);

  // ---- Imperative callback refs (set by child components on mount) ----
  const judgmentTriggerRef  = useRef<((j: JudgmentType, d: Direction) => void) | null>(null);
  const comboDisplayFnRef   = useRef<((combo: number, isBreak: boolean) => void) | null>(null);
  const hypeOverlayFnRef    = useRef<((combo: number, isBreak: boolean) => void) | null>(null);
  const chromaticTriggerRef = useRef<(() => void) | null>(null);
  const flashTriggerRef     = useRef<(() => void) | null>(null);
  const hudUpdateRef        = useRef<((score: number, progress: number) => void) | null>(null);
  const countdownUpdateRef  = useRef<((phase: CountdownPhase) => void) | null>(null);

  // Stable callbacks for child registrations (avoid re-creating on each render)
  const onRegisterFlash      = useCallback((fn: () => void)                          => { flashTriggerRef.current      = fn; }, []);
  const onRegisterHypeUpdate = useCallback((fn: (c: number, b: boolean) => void)     => { hypeOverlayFnRef.current     = fn; }, []);
  const onRegisterChromatic  = useCallback((fn: () => void)                          => { chromaticTriggerRef.current  = fn; }, []);
  const onRegisterCombo      = useCallback((fn: (c: number, b: boolean) => void)     => { comboDisplayFnRef.current    = fn; }, []);
  const onRegisterJudgment   = useCallback((fn: (j: JudgmentType, d: Direction) => void) => { judgmentTriggerRef.current = fn; }, []);
  const onRegisterHUD        = useCallback((fn: (score: number, progress: number) => void) => { hudUpdateRef.current = fn; }, []);
  const onRegisterCountdown  = useCallback((fn: (phase: CountdownPhase) => void)     => { countdownUpdateRef.current  = fn; }, []);

  // Whether we are running real gameplay (vs demo)
  const isRealGame = chartData !== null;
  // Whether the active chart uses YouTube IFrame for audio
  const isYouTubeGame = chartData?.source === 'youtube';

  useEffect(() => {
    if (!webGPUSupported || !containerRef.current) return;

    // Reset touch input state for the new game session:
    // demo mode enables touch immediately; real game enables at GO.
    setTouchInputEnabled(!chartData);

    const container = containerRef.current;

    // Determine which notes / duration / BPM to use
    const notes: Note[]   = chartData ? chartData.charts[difficulty].notes : DEMO_NOTES;
    const chartDuration   = chartData ? chartData.duration                 : DEMO_DURATION;
    const bpm             = chartData ? chartData.bpm                      : DEMO_BPM;
    const beatInterval    = 60 / bpm;  // seconds per beat

    // Total judgeable slots — for game-end detection in real mode
    const totalNotes  = isRealGame ? countJudgeableNotes(notes) : 0;
    const judgedCountRef  = { current: 0 };
    const gameEndedRef    = { current: false };

    // Reset store for a fresh game session
    if (isRealGame) {
      useGameStore.getState().resetGame();
      useGameStore.getState().startCountdown();
    }

    // -----------------------------------------------------------------------
    // Three.js setup
    // -----------------------------------------------------------------------

    // For YouTube songs, use alpha=true so the canvas is transparent and the
    // video below shows through.  For local/demo, keep alpha off (solid dark bg).
    const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: isYouTubeGame });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    // Transparent canvas for YouTube (background comes from video + CSS).
    // Solid dark background for local audio and demo mode.
    scene.background = isYouTubeGame ? null : new THREE.Color(0x080810);

    const VIEW_HEIGHT = 10;
    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.OrthographicCamera(
      (-VIEW_HEIGHT * aspect) / 2,
      (VIEW_HEIGHT * aspect) / 2,
      VIEW_HEIGHT / 2,
      -VIEW_HEIGHT / 2,
      0.1,
      1000,
    );
    camera.position.z = 10;

    function onResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      const a = w / h;
      camera.left   = (-VIEW_HEIGHT * a) / 2;
      camera.right  = (VIEW_HEIGHT * a) / 2;
      camera.top    = VIEW_HEIGHT / 2;
      camera.bottom = -VIEW_HEIGHT / 2;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);

    // -----------------------------------------------------------------------
    // Engine subsystems
    // -----------------------------------------------------------------------

    const timingEngine = new TimingEngine();
    timingEngine.loadNotes(notes);
    // Widen judgment windows by 30ms on touch devices to compensate for
    // capacitive touch latency (Issue 33).
    timingEngine.touchWindowBonus = isMobile ? 30 : 0;

    // -----------------------------------------------------------------------
    // Local audio setup (Issue 17)
    // -----------------------------------------------------------------------

    // audioPlayer is only created for real games with a local audio URL.
    // For demo mode and YouTube songs it stays null.
    let audioPlayer: AudioPlayer | null = null;
    let audioStarted = false;

    if (isRealGame && chartData.source === 'local' && chartData.audio_url) {
      audioPlayer = new AudioPlayer();
      timingEngine.segmentStart = chartData.segment_start ?? 0;

      // Load audio but don't wire the timing engine yet — setAudioElement() is
      // called after audio actually starts playing (at "GO!") so that early
      // resyncs during the countdown don't snap the clock to 0.
      audioPlayer
        .load(chartData.audio_url, chartData.segment_start ?? 0)
        .catch((err: unknown) => {
          console.warn('[AudioPlayer] Failed to load audio:', err);
        });
    }

    // YouTube player for custom URL songs (Issue 31)
    let ytPlayer: YouTubePlayer | null = null;
    let ytStarted = false;

    if (isRealGame && chartData.source === 'youtube' && chartData.video_id && ytContainerRef.current) {
      ytPlayer = new YouTubePlayer();
      const segStart = chartData.segment_start ?? 0;

      // Create an inner element for YouTube to replace with an iframe.
      // Using a child (not the container itself) avoids React DOM conflicts
      // since YouTube replaces the target element with an <iframe>.
      const ytInner = document.createElement('div');
      ytInner.style.width = '100%';
      ytInner.style.height = '100%';
      ytContainerRef.current.appendChild(ytInner);

      ytPlayer
        .load(ytInner, chartData.video_id, segStart)
        .then(() => {
          // Player is ready — setTimeSource is wired at "GO" so the countdown
          // period doesn't corrupt the clock anchor.
        })
        .catch((err: unknown) => {
          console.warn('[YouTubePlayer] Failed to load:', err);
        });
    }

    // In real-game mode start the clock 3 seconds early so arrows are visibly
    // approaching during the countdown; demo mode starts at 0 immediately.
    timingEngine.play(isRealGame ? -3 : 0);

    const postProcessing = new PostProcessingManager(renderer, scene, camera);
    const background     = new BackgroundRenderer(scene);
    const arrowRenderer  = new ArrowRenderer(scene);
    const scrollManager  = new ArrowScrollManager(arrowRenderer);
    scrollManager.scrollMultiplier = 2;
    scrollManager.loadChart(notes);
    const receptorRenderer = new ReceptorRenderer(scene);
    const hitEffects       = new HitEffectRenderer(scene);

    // -----------------------------------------------------------------------
    // Combo tracking
    // -----------------------------------------------------------------------

    const comboRef = { current: 0 };

    function notifyCombo(combo: number, isBreak: boolean) {
      comboDisplayFnRef.current?.(combo, isBreak);
      hypeOverlayFnRef.current?.(combo, isBreak);
      background.setComboLevel(getHypeLevel(combo));
    }

    function resetCombo() {
      comboRef.current = 0;
      notifyCombo(0, false);
      hitEffects.setHypeLevel(0);
    }

    // -----------------------------------------------------------------------
    // End-game logic
    // -----------------------------------------------------------------------

    function endGameSession() {
      inputHandler.disable();
      if (isRealGame) {
        const store = useGameStore.getState();
        store.endGame();
        const result = store.computeGameResult();
        store.setGameResult(result);
      }
    }

    function checkGameEnd() {
      if (isRealGame && !gameEndedRef.current && judgedCountRef.current >= totalNotes) {
        gameEndedRef.current = true;
        // Small delay so the last hit effects play out before ending
        setTimeout(endGameSession, 500);
      }
    }

    // -----------------------------------------------------------------------
    // Auto-miss callback
    // -----------------------------------------------------------------------

    scrollManager.onMiss = (noteIndex: number, dir: Direction) => {
      timingEngine.markJudged(noteIndex, dir);

      if (isRealGame) {
        judgedCountRef.current += 1;
        useGameStore.getState().processJudgment({
          hit: false,
          judgment: 'miss',
          offsetMs: 0,
          noteIndex,
          direction: dir,
        } as JudgmentResult);
        checkGameEnd();
      }

      // Break combo
      if (comboRef.current > 0) {
        comboRef.current = 0;
        notifyCombo(0, true);
        hitEffects.setHypeLevel(0);
      }
    };

    // -----------------------------------------------------------------------
    // Keyboard input
    // -----------------------------------------------------------------------

    const inputHandler = new InputHandler();
    // Demo mode: enable immediately.  Real game: enabled at GO by the animation loop.
    if (!isRealGame) inputHandler.enable();

    // Shared callback used by both keyboard InputHandler and TouchInputZones
    const handleInput = (direction: Direction, timestamp: number) => {
      // Fallback: start audio on first keypress if it wasn't started at GO!
      // (handles browsers that block autoplay even after a prior user gesture).
      if (audioPlayer && !audioStarted) {
        audioStarted = true;
        const currentGameTime = timingEngine.getCurrentTime();
        audioPlayer.seek(currentGameTime);
        audioPlayer.play().then(() => {
          if (audioPlayer) timingEngine.setAudioElement(audioPlayer.element);
        }).catch((err: unknown) => {
          console.warn('[AudioPlayer] play() failed:', err);
        });
      }

      // Fallback for YouTube: start on first keypress if not yet started
      if (ytPlayer && !ytStarted && ytPlayer.isReady) {
        ytStarted = true;
        const currentGameTime = timingEngine.getCurrentTime();
        ytPlayer.seekTo(currentGameTime);
        ytPlayer.play();
        timingEngine.setTimeSource(() => ytPlayer!.getCurrentTime());
      }

      const result = timingEngine.judge(direction, timestamp);
      if (!result) return; // no note in window — empty press

      const { judgment } = result;

      // Fade the arrow in the scroll manager
      scrollManager.judgeArrow(result.noteIndex, judgment);

      // Update persistent scoring (real game only)
      if (isRealGame) {
        judgedCountRef.current += 1;
        useGameStore.getState().processJudgment(result);
        checkGameEnd();
      }

      // Combo tracking
      const prevCombo = comboRef.current;
      if (judgment === 'miss') {
        comboRef.current = 0;
        notifyCombo(0, true);
        hitEffects.setHypeLevel(0);
      } else {
        comboRef.current += 1;
        const newCombo = comboRef.current;
        notifyCombo(newCombo, false);

        const newLevel  = getHypeLevel(newCombo);
        const prevLevel = getHypeLevel(prevCombo);
        if (newLevel !== prevLevel) hitEffects.setHypeLevel(newLevel);

        for (const milestone of COMBO_MILESTONES) {
          if (prevCombo < milestone && newCombo >= milestone) {
            chromaticTriggerRef.current?.();
            break;
          }
        }
      }

      // Visual feedback
      hitEffects.triggerHitEffect(direction, judgment);
      receptorRenderer.flashReceptor(direction, judgment);
      judgmentTriggerRef.current?.(judgment, direction);

      if (judgment === 'perfect') {
        flashTriggerRef.current?.();
      }
    };

    // Wire the shared handler to the keyboard InputHandler
    inputHandler.onInput = handleInput;

    // Wire the shared handler to the TouchInputZones ref (used by the React component)
    inputHandlerCallbackRef.current = handleInput;

    // -----------------------------------------------------------------------
    // Game loop
    // -----------------------------------------------------------------------

    const loopStart    = performance.now();
    let lastFrameTime  = performance.now();
    let lastBeatIndex  = -1;

    // Countdown state (real game only).
    // Timing engine starts at -3s; each second corresponds to one phase.
    // Initialize to -1 (hidden) so the first frame always triggers an update call,
    // revealing "3" as soon as the CountdownOverlay's useEffect has registered its fn.
    let countdownPhase: CountdownPhase = -1;
    let inputEnabled = !isRealGame; // demo mode: already enabled above

    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt  = Math.min((now - lastFrameTime) / 1000, 0.05);
      lastFrameTime = now;

      const songTime    = timingEngine.getCurrentTime();
      const realElapsed = (now - loopStart) / 1000;

      // -----------------------------------------------------------------------
      // Countdown management (real game only)
      // -----------------------------------------------------------------------
      if (isRealGame) {
        if (!inputEnabled) {
          // Compute the phase from song time (-3 → 0 window)
          const newPhase: CountdownPhase =
            songTime < -2 ? 3 :
            songTime < -1 ? 2 :
            songTime < 0  ? 1 : 0;

          if (newPhase !== countdownPhase) {
            countdownPhase = newPhase;
            countdownUpdateRef.current?.(newPhase);
          }

          // At GO (t >= 0): enable input and start audio / YouTube player
          if (songTime >= 0) {
            inputEnabled = true;
            inputHandler.enable();
            setTouchInputEnabled(true);
            useGameStore.getState().startPlaying();

            if (audioPlayer && !audioStarted) {
              audioStarted = true;
              audioPlayer.seek(0);
              audioPlayer.play().then(() => {
                if (audioPlayer) timingEngine.setAudioElement(audioPlayer.element);
              }).catch((err: unknown) => {
                console.warn('[AudioPlayer] play() at GO! failed (will retry on first key):', err);
                audioStarted = false; // allow keypress fallback
              });
            }

            if (ytPlayer && !ytStarted && ytPlayer.isReady) {
              ytStarted = true;
              // Seek to exact game start in case the countdown buffered differently
              ytPlayer.seekTo(0);
              ytPlayer.play();
              // Wire periodic resync: YouTubePlayer.getCurrentTime() returns
              // game-relative seconds (segmentStart already subtracted).
              timingEngine.setTimeSource(() => ytPlayer!.getCurrentTime());
            }
          }
        } else if (songTime >= 0.5 && countdownPhase !== -1) {
          // Hide the "GO!" text after it has been visible for ~0.5s
          countdownPhase = -1;
          countdownUpdateRef.current?.(-1);
        }
      }

      // Demo loop: restart when we reach the end of the chart
      if (!isRealGame && songTime >= DEMO_DURATION) {
        resetCombo();
        timingEngine.play(0);
        timingEngine.resetJudgments();
        scrollManager.loadChart(DEMO_NOTES);
      }

      // Also end real game if we've run past the chart duration (safety net)
      if (isRealGame && !gameEndedRef.current && songTime >= chartDuration + 0.5) {
        gameEndedRef.current = true;
        setTimeout(endGameSession, 500);
      }

      // Beat pulse for background
      const beatIndex = Math.floor(songTime / beatInterval);
      if (beatIndex !== lastBeatIndex) {
        lastBeatIndex = beatIndex;
        background.pulseOnBeat();
      }

      background.update(dt, realElapsed);
      scrollManager.update(songTime);
      arrowRenderer.update();
      receptorRenderer.update(realElapsed);

      const { shakeX, shakeY } = hitEffects.update(dt);
      camera.position.x = shakeX;
      camera.position.y = shakeY;

      // HUD update (real game only)
      if (isRealGame && hudUpdateRef.current) {
        const score    = useGameStore.getState().score;
        const progress = chartDuration > 0 ? Math.min(songTime / chartDuration, 1) : 0;
        hudUpdateRef.current(score, progress);
      }

      postProcessing.render();
    });

    // -----------------------------------------------------------------------
    // Cleanup
    // -----------------------------------------------------------------------

    return () => {
      inputHandler.dispose();
      audioPlayer?.dispose();
      ytPlayer?.dispose();
      timingEngine.dispose();
      scrollManager.dispose();
      arrowRenderer.dispose();
      receptorRenderer.dispose();
      hitEffects.dispose();
      background.dispose();
      postProcessing.dispose();
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // Re-run whenever chart changes (new song or difficulty selected)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webGPUSupported, chartData, difficulty]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!webGPUSupported) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-game-bg">
        <div className="max-w-md px-6 text-center">
          <div className="mb-4 text-5xl">⚠</div>
          <h2 className="mb-3 text-2xl font-bold text-neon-cyan">WebGPU Not Supported</h2>
          <p className="text-game-text-dim">
            This game requires WebGPU. Please use Chrome 113+, Edge 113+, or another browser with
            WebGPU enabled.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-game-bg">
      {/* YouTube video layer — behind the Three.js canvas (YouTube source only) */}
      {isYouTubeGame && (
        <div
          ref={ytContainerRef}
          className="absolute inset-0"
          style={{
            opacity: 0.5,
            zIndex: 0,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Three.js canvas container */}
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ zIndex: 1 }}
      />

      {/* Post-processing CSS effects: vignette + Perfect screen flash */}
      <ScreenEffects onRegisterFlash={onRegisterFlash} />

      {/* Screen border glow + chromatic aberration */}
      <HypeOverlay
        onRegisterUpdate={onRegisterHypeUpdate}
        onRegisterChromatic={onRegisterChromatic}
      />

      {/* Combo counter with escalating hype visuals */}
      <ComboDisplay onRegisterUpdate={onRegisterCombo} />

      {/* Floating judgment text (PERFECT! / GREAT! / MISS) */}
      <JudgmentDisplay onRegisterTrigger={onRegisterJudgment} />

      {/* Score + progress bar — only shown in real gameplay */}
      {isRealGame && <GameplayHUD onRegisterUpdate={onRegisterHUD} />}

      {/* 3-2-1-GO countdown overlay — only shown in real gameplay */}
      <CountdownOverlay isActive={isRealGame} onRegisterUpdate={onRegisterCountdown} />

      {/* Touch input zones — only shown on touch devices */}
      {isMobile && (
        <TouchInputZones
          enabled={touchInputEnabled}
          onInput={(direction, timestamp) => {
            inputHandlerCallbackRef.current?.(direction, timestamp);
          }}
        />
      )}
    </div>
  );
}
