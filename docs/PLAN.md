# Dance Dance Devolution — Implementation Plan

The PRD is stored in `/docs/PRD.md`
Use Agent Teams and/or subagents as appropriate, to perform tasks in parallel.

---

**Issue 1**

Status: COMPLETE

Task: Project scaffolding & build configuration

Set up the frontend project structure properly:
- Configure Vite with Tailwind CSS v4 plugin (already in deps, not in vite.config.ts)
- Add path aliases (`@/` → `src/`)
- Create folder structure: `src/{components,engine,rendering,stores,types,screens,assets,data}`
- Add `public/audio/` directory for pre-loaded song MP3s
- Add `public/data/` directory for static chart JSON files
- Configure viewport meta tag for mobile (no zoom, playsinline)
- Set up base CSS with Tailwind (dark background, neon color tokens)

Acceptance criteria:
- [x] `pnpm dev` starts with no errors
- [x] `pnpm build` succeeds with no TypeScript errors
- [x] Tailwind classes work in a test component
- [x] Path aliases resolve correctly
- [x] Folder structure exists

---

**Issue 2**

Status: COMPLETE

Task: Define TypeScript types and data contracts

Create all shared interfaces from PRD Section 9 in `src/types/`:
- `ChartData`, `Chart`, `Note` (backend → frontend chart format)
- `JobStatus` (polling response)
- `CatalogEntry` (pre-loaded song metadata)
- `GameResult` (score/results)
- `JudgmentResult` (timing engine output)
- `Direction`, `Difficulty`, `JudgmentType` union types

Acceptance criteria:
- [x] All interfaces from PRD Section 9 are defined
- [x] Types compile with no errors
- [x] Types are exported from a barrel `src/types/index.ts`

---

**Issue 3**

Status: COMPLETE

Task: Zustand game state store

Create Zustand stores in `src/stores/`:
- `gameStore`: current screen (home/select/loading/gameplay/results), active song, difficulty, game state (idle/countdown/playing/ended), score/combo/judgments
- `audioStore`: current time, playing state, audio source type (local/youtube)
- `jobStore`: pending YouTube analysis jobs (`Map<jobId, JobStatus>`), polling logic

Acceptance criteria:
- [x] Stores are created with sensible defaults
- [x] Screen navigation actions work (setScreen, startGame, endGame)
- [x] Score/combo/judgment update actions work
- [x] Job polling can be started/stopped

---

**Issue 4**

Status: COMPLETE

Task: Three.js WebGPU renderer setup

Initialize Three.js with WebGPURenderer in a React component:
- Create `<GameCanvas />` component that mounts a Three.js scene
- Use `WebGPURenderer` (not WebGLRenderer) — WebGPU only
- Set up `OrthographicCamera` for 2D gameplay
- Handle canvas resize on window resize
- Detect WebGPU support; if absent, render a "Please use a modern browser" message
- Use `requestAnimationFrame` game loop via Three.js `renderer.setAnimationLoop`

Acceptance criteria:
- [x] WebGPU renderer initializes and renders a blank scene
- [x] Canvas fills the viewport and resizes correctly
- [x] Non-WebGPU browsers see a friendly fallback message
- [x] No console errors on supported browsers
- [x] Component cleans up on unmount (dispose renderer)

---

**Issue 5**

Status: COMPLETE

Task: Arrow geometry and instanced mesh system

Build the arrow rendering system (PRD Section 4.4):
- Create arrow `ShapeGeometry` procedurally (chevron/arrow shape)
- One `InstancedMesh` per direction (4 total: left, down, up, right)
- Color per direction: left=magenta, down=cyan, up=green, right=orange
- Support setting per-instance position, opacity, and visibility
- Object pool: pre-allocate ~50 instances per direction, show/hide as needed
- Arrows should glow (emissive material or custom shader)

Acceptance criteria:
- [x] Four colored arrows render on screen
- [x] Arrows use instanced rendering (verified: 4 draw calls, not N)
- [x] Arrows can be individually positioned and shown/hidden
- [x] Arrows have a visible neon glow effect
- [x] Arrow shapes are oriented correctly per direction (rotated appropriately)

---

**Issue 6**

Status: COMPLETE

Task: Step Zone receptors

Build the static receptor row at the top of the play area (PRD Section 4.1):
- Four receptor outlines (same arrow shape, hollow/outlined)
- Positioned at fixed Y near top of screen
- Subtle pulsing glow animation (breathing effect)
- Flash bright white on hit (triggered externally)
- Expand + ripple effect on Perfect hit

Acceptance criteria:
- [x] Four receptor outlines visible at fixed positions
- [x] Receptors have a subtle breathing glow animation
- [x] `flashReceptor(direction, judgment)` method triggers appropriate visual response
- [x] Perfect flash is visually distinct from Great flash

---

**Issue 7**

Status: COMPLETE

Task: Arrow scrolling and lifecycle system

Implement the arrow spawn → scroll → judge/despawn lifecycle:
- Arrows spawn off-screen at bottom, scroll upward at constant speed
- Speed derived from a scroll speed multiplier (default 2x)
- Arrows are positioned based on `(noteTime - currentSongTime) * scrollSpeed`
- When an arrow passes the step zone without being hit → mark as missed
- Hit or missed arrows fade out and return to the pool
- Only arrows within a visible window are rendered (hybrid frustum culling)

Acceptance criteria:
- [x] Arrows scroll smoothly upward from bottom to top
- [x] Arrow Y position is correctly derived from song time
- [x] Arrows that pass the step zone are auto-missed
- [x] Pool recycling works (no object creation during gameplay)
- [x] Scroll speed can be adjusted

---

**Issue 8**

Status: COMPLETE

Task: Timing engine

Build the core timing engine (PRD Section 4.5):
- High-resolution clock using `performance.now()`
- Track current song position in seconds
- For local audio: anchor to `<audio>` element's `currentTime` with periodic re-sync
- `judge(direction, pressTime)` → find nearest unjudged arrow in that column within window
- Judgment windows: Perfect ±80ms, Great ±140ms, Miss >140ms
- Return `JudgmentResult` with hit/judgment/offsetMs/noteIndex

Acceptance criteria:
- [x] `getCurrentTime()` returns accurate song position
- [x] `judge()` correctly identifies the nearest arrow and assigns judgment
- [x] Perfect window is ±80ms, Great is ±140ms
- [x] Already-judged arrows are not re-judged
- [x] Clock handles pause/resume correctly

---

**Issue 9**

Status: COMPLETE

Task: Keyboard input handler

Handle keyboard input for gameplay (PRD Section 4.6):
- Listen for `keydown` on arrow keys (← ↓ ↑ →) and DFJK
- Capture `performance.now()` timestamp at keydown
- Ignore `event.repeat` (held keys)
- `preventDefault()` on arrow keys to stop page scrolling
- Expose a callback: `onInput(direction, timestamp)`
- Support enabling/disabling input (e.g., during countdown or results)

Acceptance criteria:
- [x] Arrow keys and DFJK both trigger input callbacks
- [x] Held keys do not re-trigger (event.repeat filtered)
- [x] Arrow keys don't scroll the page
- [x] Input can be enabled/disabled
- [x] Timestamp is captured at keydown moment

---

**Issue 10**

Status: COMPLETE

Task: Scoring and combo system

Implement score tracking (PRD Section 2):
- Perfect = 300 points, Great = 100 points, Miss = 0
- Combo: continues on Perfect/Great, breaks on Miss
- Track: score, perfect count, great count, miss count, max combo, current combo
- Calculate accuracy: `(perfect * 1.0 + great * 0.5) / totalNotes * 100`
- Assign letter grade: S (98%+), A (90%+), B (80%+), C (70%+), D (<70%)
- Expose `processJudgment(result: JudgmentResult)` that updates all state

Acceptance criteria:
- [x] Score increments correctly for each judgment type
- [x] Combo continues on hit, breaks on miss
- [x] Max combo is tracked
- [x] Accuracy formula matches PRD
- [x] Grade assignment matches PRD thresholds

---

**Issue 11**

Status: COMPLETE

Task: Create hardcoded test chart

Manually author a chart JSON file for testing (before backend exists):
- Pick a freely available audio clip or simple beat pattern (~60s)
- Write Easy chart: quarter notes on the beat, ~60 notes/min
- Write Hard chart: eighth notes + some jumps, ~150 notes/min
- Follow the `ChartData` interface from Issue 2
- Place in `public/data/test-chart.json`
- Include a corresponding audio file in `public/audio/`

Acceptance criteria:
- [x] Chart JSON is valid and matches ChartData interface
- [x] Easy chart has reasonable note density (~40-80 notes/min)
- [x] Hard chart has higher density with some jumps
- [x] Accompanying audio file exists and plays
- [x] Notes are beat-aligned (times correspond to audible beats)

---

**Issue 12**

Status: COMPLETE

Task: Hit effects and particle system

Build the visual feedback system for hits/misses (PRD Section 4.2):
- **Perfect:** Gold/white particle explosion (80-120 particles), screen bloom flash
- **Great:** Blue particle burst (40 particles), receptor glow
- **Miss:** Red X stamp, screen shake (3-5 frames)
- GPU-driven particles with additive blending, fade out over ~0.5s
- Judgment text: animated "Perfect!", "Great!", "Miss" text that floats up and fades

Acceptance criteria:
- [x] `triggerHitEffect(direction, judgment)` produces the correct visual
- [x] Particle burst has correct color and count per judgment
- [x] Screen shake occurs on miss
- [x] Judgment text appears and animates
- [x] Effects don't cause frame drops (particle pool, not per-hit allocation)

---

**Issue 13**

Status: COMPLETE

Task: Combo escalation visuals and hype mode

Implement escalating visual intensity with combo (PRD Section 4.2):
- At 10+ combo: combo counter scales up, add fire/glow aura
- At 25+ combo: screen border starts glowing, chromatic aberration flash
- At 50+ combo: full hype mode — background intensifies, more particles, everything cranked
- Combo counter display scales with current combo
- Reset intensity on combo break

Acceptance criteria:
- [x] Visual intensity clearly increases at 10, 25, 50 combo thresholds
- [x] Combo break visually resets intensity
- [x] Hype mode at 50+ is dramatically different from baseline
- [x] Transitions between intensity levels are smooth (not jarring)

---

**Issue 14**

Status: COMPLETE

Task: Background visuals — neon grid and beat-reactive glow

Create the background layer (PRD Section 4.2):
- Dark (near-black) base
- Animated neon grid lines (Tron-style perspective grid)
- Ambient floating particles (slow, subtle)
- Beat-reactive radial pulse/glow (triggered by beat timestamps)
- At high combos, background becomes more alive (more particles, brighter grid)

Acceptance criteria:
- [x] Neon grid renders with perspective effect
- [x] Grid lines are animated (scrolling or pulsing)
- [x] `pulseOnBeat()` triggers a visible radial glow
- [x] Ambient particles float in background
- [x] Background intensity responds to combo level

---

**Issue 15**

Status: COMPLETE

Task: Post-processing pipeline

Set up Three.js post-processing passes (PRD Section 4.3):
- **Bloom (UnrealBloom):** Always on, subtle — makes neon glow
- **Vignette:** Always on, subtle — draws focus to center
- **Screen flash:** Brief white overlay on Perfect (2 frames, 10% opacity)
- **Chromatic aberration:** On combo milestones (25, 50, 100) — brief, celebratory
- Ensure post-processing works with WebGPU renderer

Acceptance criteria:
- [x] Bloom makes emissive materials glow convincingly
- [x] Vignette darkens screen edges
- [x] `triggerFlash()` and `triggerChromaticAberration()` work on demand
- [x] Post-processing does not drop FPS below 60 on desktop

---

**Issue 16**

Status: COMPLETE

Task: Wire up core gameplay loop

Integrate all engine components into a playable game loop:
- Load chart data → populate arrow pool with note times
- Game loop: update timing engine → position arrows → check for auto-misses
- On keyboard input → call timing engine judge → update scoring → trigger hit effect → update receptors
- Sync arrow positions to `(noteTime - currentTime) * scrollSpeed`
- UI overlay: render score, combo counter, song progress bar (HTML or Three.js text)
- Song ends when all notes are judged or audio finishes

Acceptance criteria:
- [x] Pressing arrow keys at the right time registers hits with correct judgments
- [x] Arrows scroll in sync with audio
- [x] Score, combo, and progress update in real-time
- [x] Game ends when song completes
- [x] No visual glitches or timing inconsistencies

---

**Issue 17**

Status: COMPLETE

Task: Local audio playback

Implement audio playback for pre-loaded songs:
- Load MP3 from `public/audio/` via `<audio>` element
- Expose play/pause/seek/getCurrentTime
- Create AudioContext on user gesture (browser policy)
- Sync timing engine to `<audio>.currentTime` with periodic re-sync every ~500ms
- Handle segment offsets: if chart has `segment_start`, seek to that position

Acceptance criteria:
- [x] Audio plays from local MP3 files
- [x] `getCurrentTime()` matches audio position within ±10ms
- [x] AudioContext is created on user gesture (no autoplay policy violations)
- [x] Segment start offset is applied correctly

---

**Issue 18**

Status: COMPLETE

Task: 3-2-1 countdown and game start sequence

Implement the pre-game countdown (PRD Section 4.5):
- After song/chart is loaded and audio is ready, show "3... 2... 1... GO!"
- Countdown renders as animated overlay (large text, neon styled)
- Audio playback begins at "GO"
- Input is disabled during countdown
- Countdown absorbs any audio buffering time

Acceptance criteria:
- [x] 3-2-1-GO countdown displays before gameplay
- [x] Audio starts precisely at GO
- [x] Input is blocked during countdown
- [x] Countdown looks polished (animated, neon-styled text)

---

**Issue 19**

Status: COMPLETE

Task: Screen routing and navigation

Set up screen-based navigation using React Router or Zustand-driven routing:
- Screens: Home, SongSelect, Loading (analysis), Gameplay, Results
- Transitions between screens (can be simple fades initially)
- URL routes or state-driven (whichever is simpler)
- Preserve game state across screen changes (Zustand)

Acceptance criteria:
- [x] All 5 screens are routable
- [x] Navigation between screens works
- [x] Back button / browser navigation doesn't break state
- [x] Screen transitions are smooth

---

**Issue 20**

Status: COMPLETE

Task: Landing / Home screen

Build the home screen (PRD Section 5.2):
- Title: "DANCE DANCE DEVOLUTION" with neon typography
- Subtitle: "A rhythm game powered by WebGPU + AI"
- Featured song "Play Now" button (large, prominent) with song name and Easy/Hard choice
- "Pick a song" section with 3 song thumbnails
- YouTube URL input field with "Analyze" button
- Footer: "Use arrow keys (desktop) or tap (mobile) to play"
- Animated background (can reuse neon grid from Issue 14, or a simpler CSS version initially)

Acceptance criteria:
- [x] Home screen renders with all sections from PRD wireframe
- [x] "Play Now" navigates to gameplay with featured song
- [x] Song thumbnails navigate to gameplay
- [x] YouTube URL input exists (functionality wired in later)
- [x] Page looks impressive — neon aesthetic, polished typography

---

**Issue 21**

Status: COMPLETE

Task: Song Select screen

Build the song selection grid (PRD Section 5.3):
- Grid/list of pre-loaded songs (from catalog data)
- Each card: thumbnail, title, artist, BPM
- Two buttons per card: Easy / Hard
- Clicking difficulty goes directly to gameplay (no confirmation)
- Load catalog from static JSON or hardcoded data

Acceptance criteria:
- [x] Song cards display for all catalog entries
- [x] Easy/Hard buttons navigate to gameplay with correct song + difficulty
- [x] Cards show thumbnail, title, artist, BPM

---

**Issue 22**

Status: COMPLETE

Task: Results screen

Build the post-game results screen (PRD Section 5.6):
- "STAGE CLEAR" header
- Song title, artist, difficulty
- Letter grade (S/A/B/C/D) displayed prominently
- Stats: score, perfect, great, miss, max combo, accuracy %
- "Retry" button (replay same song + difficulty)
- "New Song" button (back to home/select)

Acceptance criteria:
- [x] Results screen shows all stats from GameResult
- [x] Letter grade is correct and prominently displayed
- [x] Retry replays the same song
- [x] New Song navigates back to home
- [x] Screen has polished neon aesthetic

---

**Issue 23**

Status: COMPLETE

Task: Pre-loaded song catalog data

Create the catalog of 3 pre-loaded songs (PRD Section 16):
- Sandstorm (Darude, ~136 BPM, featured)
- Butterfly (Smile.dk, ~154 BPM)
- Blinding Lights (The Weeknd, ~171 BPM)
- Define catalog JSON with: id, title, artist, bpm, duration, segment_start, audio_url, thumbnail_url, featured flag
- Source or create placeholder audio files (trimmed MP3 segments)
- Source or create placeholder thumbnail images
- Generate chart JSON for each song (manually or via script)

Acceptance criteria:
- [x] Catalog JSON exists with all 3 songs
- [x] Each song has an audio file in `public/audio/`
- [x] Each song has a chart JSON in `public/data/`
- [x] Each song has a thumbnail image
- [x] Featured flag is set on Sandstorm

---

**Issue 24**

Status: COMPLETE

Task: FastAPI backend project setup

Set up the Python backend:
- Create `backend/` directory with FastAPI project
- `pyproject.toml` with dependencies: fastapi, uvicorn, yt-dlp, librosa, numpy
- CORS middleware configured for frontend origin
- Health check endpoint (`GET /api/health`)
- Project structure: `backend/{main.py, routers/, services/, models/}`
- Basic Dockerfile for VPS deployment

Acceptance criteria:
- [x] `uvicorn main:app` starts with no errors
- [x] `GET /api/health` returns 200
- [x] CORS allows frontend origin
- [x] All dependencies install successfully

---

**Issue 25**

Status: COMPLETE

Task: yt-dlp audio extraction service

Implement YouTube audio extraction (PRD Section 6.3):
- Extract audio-only as WAV (22050 Hz mono) using yt-dlp
- Store in temp directory, return file path
- Extract video metadata (title, artist, duration, thumbnail) via `--dump-json`
- Handle errors: invalid URL, unavailable video, extraction failure
- Clean up temp files after processing

Acceptance criteria:
- [x] Given a YouTube URL, extracts audio to a WAV file
- [x] Metadata (title, duration) is extracted correctly
- [x] Invalid URLs return a clear error
- [x] Temp files are cleaned up

---

**Issue 26**

Status: COMPLETE

Task: librosa audio analysis service

Implement audio analysis (PRD Section 6.2):
- Load WAV with librosa (22050 Hz mono)
- Detect BPM via `librosa.beat.beat_track`
- Get beat positions (times in seconds)
- Get onset positions via `librosa.onset.onset_detect`
- Compute RMS energy curve
- Return structured analysis result

Acceptance criteria:
- [x] BPM detection is accurate within ±5 of actual
- [x] Beat times align with audible beats
- [x] Onset times capture note onsets
- [x] Energy curve is computed
- [x] Analysis completes in <15 seconds for a 4-minute song

---

**Issue 27**

Status: COMPLETE

Task: Song segment selection algorithm

Implement best-segment detection for long songs (PRD Section 6.5):
- If song ≤ 90s, use entire song
- Otherwise, sliding window: score by onset density × average energy × beat alignment
- Snap segment start to nearest beat
- Return Segment(start, end, duration)

Acceptance criteria:
- [x] Short songs (≤90s) return the full duration
- [x] Long songs select a high-energy segment
- [x] Segment start is snapped to a beat boundary
- [x] Algorithm runs in <1 second

---

**Issue 28**

Status: COMPLETE

Task: Chart generation algorithm

Implement note placement + arrow assignment (PRD Section 8):
- **Note placement:** Easy = quarter-note beats (40-80/min cap); Hard = beats + onsets on 16th grid (120-250/min cap)
- **Arrow assignment:** Alternate feet, downbeats → center arrows (D/U), offbeats → side arrows (L/R), avoid repeats
- **Jumps (Hard only):** On strong downbeats every ~4 bars
- `filter_min_gap()` to prevent notes too close together
- Output matches `Chart` interface (array of `Note` objects)

Acceptance criteria:
- [x] Easy chart has ~40-80 notes/min
- [x] Hard chart has ~120-250 notes/min with jumps
- [x] No two notes are closer than the minimum gap
- [x] Arrow patterns alternate feet naturally
- [x] Jumps appear only in Hard mode on strong beats

---

**Issue 29**

Status: COMPLETE

Task: Backend job queue and API endpoints

Wire the full processing pipeline (PRD Section 6.6):
- `POST /api/analyze` → enqueue job, return job_id
- `GET /api/status/:job_id` → return job status with progress
- `GET /api/chart/:video_id` → return cached chart (404 if not found)
- `GET /api/catalog` → return pre-loaded song list
- asyncio task queue with `Semaphore(2)` for concurrency
- In-memory job store, SQLite cache for results
- Pipeline: extract → analyze → segment → generate chart → cache → done

Acceptance criteria:
- [x] POST /api/analyze accepts a YouTube URL and returns job_id
- [x] GET /api/status returns progress updates as processing advances
- [x] GET /api/chart returns cached chart data
- [x] GET /api/catalog returns the pre-loaded song list
- [x] Semaphore limits concurrent processing to 2
- [x] SQLite cache prevents re-processing the same video

---

**Issue 30**

Status: COMPLETE

Task: Analysis loading screen with progress polling

Build the loading screen for custom YouTube URLs (PRD Section 5.4):
- Progress bar (0-100%)
- Step indicators: extracting → analyzing → generating → complete
- Show detected BPM and title as they become available
- "Play while you wait" link to a pre-loaded song
- "Behind the scenes" info panel explaining the pipeline
- Poll `GET /api/status/:job_id` every 2 seconds
- On complete, navigate to gameplay

Acceptance criteria:
- [x] Progress bar updates as backend processes
- [x] Step indicators check off as stages complete
- [x] BPM and title appear when detected
- [x] "Play while you wait" navigates to a pre-loaded song
- [x] Auto-navigates to gameplay on completion

---

**Issue 31**

Status: COMPLETE

Task: YouTube IFrame integration for custom URLs

Integrate the YouTube IFrame Player API for custom URL gameplay (PRD Section 10.1):
- Load YouTube IFrame API dynamically
- Create player with controls hidden, keyboard disabled, playsinline
- Position player behind game canvas at 40-60% opacity
- Implement `SyncedClock` for hybrid timing (PRD Section 10.2)
- `seekTo(segment_start)` when starting game
- Periodic resync every ~2 seconds via `player.getCurrentTime()`

Acceptance criteria:
- [x] YouTube video plays behind the game canvas
- [x] Video is dimmed to 40-60% opacity
- [x] SyncedClock tracks position with <50ms drift
- [x] Periodic resync corrects drift smoothly
- [x] seekTo works for segment start offsets

---

**Issue 32**

Status: COMPLETE

Task: "Play while you wait" flow

Implement the background job tracking during gameplay (PRD Section 5.4):
- Global polling continues regardless of active screen
- `pendingJobs` Map in Zustand store tracks in-flight jobs
- If user plays a pre-loaded song while their custom song processes:
  - On results screen: show "Your song 'X' is ready! Play now"
  - Mid-gameplay: non-intrusive toast "Your song is ready!"
- Toast component: fixed-position overlay with play button

Acceptance criteria:
- [x] Polling continues while user plays a different song
- [x] Completion notification appears on results screen
- [x] Mid-game toast is non-intrusive
- [x] Clicking the notification navigates to the custom song

---

**Issue 33**

Status: READY

Task: Mobile touch support

Add touch input for mobile devices (PRD Section 11):
- Four tap zones at bottom of screen (each 25% width, 25vh tall)
- Use `touchstart` for lowest latency
- Map touch X position to direction
- Add +30ms to judgment windows on touch devices
- `preventDefault()` to block scrolling and double-tap zoom
- Responsive layout: game field adapts to portrait orientation
- Detect mobile via `navigator.maxTouchPoints > 0`

Acceptance criteria:
- [ ] Tapping the four zones registers correct directions
- [ ] Touch latency is acceptable (no perceptible delay)
- [ ] Page does not scroll or zoom during gameplay
- [ ] Judgment windows are widened on touch devices
- [ ] Layout adapts to mobile viewport

---

**Issue 34**

Status: READY

Task: Mobile performance optimization

Optimize for mobile devices (PRD Section 11.3, 13):
- Detect mobile and reduce particle counts by 50%
- Disable bloom on mobile if FPS < 30
- Reduce post-processing effects
- Target 30+ FPS on mid-range mobile devices
- Monitor FPS and adaptively reduce quality

Acceptance criteria:
- [ ] Mobile gets reduced particle counts
- [ ] FPS stays above 30 on mobile
- [ ] Bloom is disabled if performance is poor
- [ ] Desktop experience is unaffected

---

**Issue 35**

Status: READY

Task: Landing page animated WebGPU background

Make the home screen visually impressive (PRD Section 5.2):
- Animated WebGPU-driven background (neon particles, abstract shader, or beat visualizer)
- Should say "this is WebGPU" without being distracting
- Gentle pulsing/floating animation
- Lazy-load Three.js/WebGPU — show HTML landing first, then init 3D canvas
- Background should not interfere with UI readability

Acceptance criteria:
- [ ] Home screen has an animated 3D background
- [ ] Background is visually impressive but not distracting
- [ ] HTML content renders before 3D canvas initializes
- [ ] UI text remains readable over the background

---

**Issue 36**

Status: READY

Task: Audio offset slider

Add user-configurable sync offset (PRD Section 10.3):
- Range: -200ms to +200ms, default 0ms
- Simple slider in a settings panel (accessible from home screen or pause)
- Persist to localStorage
- Applied as constant offset to all judgment calculations in timing engine

Acceptance criteria:
- [ ] Slider adjusts offset between -200ms and +200ms
- [ ] Offset persists across page reloads
- [ ] Offset is applied to judgment timing
- [ ] Default is 0ms

---

**Issue 37**

Status: READY

Task: Error handling and edge cases

Handle failure modes gracefully:
- Invalid YouTube URLs → clear error message
- Backend unreachable → "Server unavailable" with retry
- yt-dlp extraction fails → specific error message
- Analysis timeout → "Taking longer than expected" with option to retry
- Network errors during polling → retry with backoff
- Rate limiting on `/api/analyze` (5/min per IP on backend)

Acceptance criteria:
- [ ] Invalid URLs show a user-friendly error
- [ ] Backend failures don't crash the frontend
- [ ] Rate limit errors are communicated clearly
- [ ] Retry options are available where appropriate

---

**Issue 38**

Status: BLOCKED by Issues 16, 33, 35

Task: Visual polish pass

Final visual quality improvements:
- Arrow trails / neon comet afterimage effect as arrows scroll
- Smooth screen transitions (fade/slide between screens)
- Loading spinners and skeleton states
- Consistent neon color palette across all screens
- Typography polish (find a good "arcade" font)
- Ensure all screens match the "Neon Arcade" aesthetic from PRD

Acceptance criteria:
- [ ] Arrows have visible trail/afterimage
- [ ] Screen transitions are smooth
- [ ] Loading states exist for all async operations
- [ ] Visual style is consistent across all screens
- [ ] Overall aesthetic matches "Neon Arcade" vision

---

**Issue 39**

Status: BLOCKED by Issue 38

Task: Performance optimization and bundle splitting

Optimize for production (PRD Section 13):
- Three.js tree-shaking (import only what's needed)
- Lazy load Three.js/WebGPU renderer (not in initial bundle)
- Code-split by route/screen
- Target: <500KB initial gzipped JS bundle
- Target: <3s load to playable on desktop, <5s on mobile
- Audit memory usage (<200MB desktop, <150MB mobile)

Acceptance criteria:
- [ ] Initial JS bundle is <500KB gzipped
- [ ] Three.js is lazy-loaded after initial paint
- [ ] No unused Three.js modules in bundle
- [ ] Memory usage stays within targets

---

**Issue 40**

Status: ON HOLD - DO NOT IMPLEMENT YET

Task: VPS deployment with Caddy

Deploy to Oracle VPS (PRD Section 14, Phase 4):
- Configure Caddy reverse proxy for `ddd.jasonherngwang.com`
- Serve frontend as static files
- Reverse proxy `/api/*` to FastAPI backend (uvicorn)
- TLS via Caddy (automatic Let's Encrypt)
- Docker Compose for backend (FastAPI + yt-dlp + ffmpeg + librosa)
- Ensure pre-loaded audio files are served with proper caching headers

Acceptance criteria:
- [ ] `ddd.jasonherngwang.com` serves the frontend
- [ ] `/api/*` routes to the backend
- [ ] HTTPS works with valid certificate
- [ ] Pre-loaded songs play without issues
- [ ] Custom YouTube URL analysis works end-to-end
