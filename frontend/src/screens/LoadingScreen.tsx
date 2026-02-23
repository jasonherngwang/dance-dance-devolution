import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useJobStore } from '@/stores/jobStore';
import { useGameStore } from '@/stores';
import type { JobStatus, JobStatusType } from '@/types';
import type { ChartData, CatalogEntry } from '@/types';

// ── Pipeline step definitions ─────────────────────────────────────────────────

type StepKey = 'extract' | 'analyze' | 'generate' | 'complete';

interface PipelineStep {
  key: StepKey;
  label: string;
  description: string;
  activeStatuses: JobStatusType[];
  doneStatuses: JobStatusType[];
}

const STEPS: PipelineStep[] = [
  {
    key: 'extract',
    label: 'Extract Audio',
    description: 'yt-dlp downloads the video and extracts audio as a WAV file at 22 kHz mono.',
    activeStatuses: ['queued', 'extracting'],
    doneStatuses: ['analyzing', 'generating', 'complete'],
  },
  {
    key: 'analyze',
    label: 'Analyze Audio',
    description: 'librosa detects BPM via autocorrelation, locates beat frames, and measures onset energy.',
    activeStatuses: ['analyzing'],
    doneStatuses: ['generating', 'complete'],
  },
  {
    key: 'generate',
    label: 'Generate Chart',
    description: 'A sliding-window algorithm picks the best 90-second segment, then places notes on a 16th-note grid.',
    activeStatuses: ['generating'],
    doneStatuses: ['complete'],
  },
  {
    key: 'complete',
    label: 'Ready',
    description: 'Chart is cached in SQLite and delivered to the frontend.',
    activeStatuses: [],
    doneStatuses: ['complete'],
  },
];

function getStepState(step: PipelineStep, status: JobStatusType): 'pending' | 'active' | 'done' {
  if (step.doneStatuses.includes(status)) return 'done';
  if (step.activeStatuses.includes(status)) return 'active';
  return 'pending';
}

// ── Background (shared neon grid) ─────────────────────────────────────────────

function NeonBg() {
  return (
    <>
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(0,255,255,0.055) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,255,0.055) 1px, transparent 1px)
          `,
          backgroundSize: '52px 52px',
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 80% 70% at 50% 50%, transparent 0%, rgba(8,8,16,0.92) 100%)`,
        }}
      />
      <div
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.018) 0px, rgba(255,255,255,0.018) 1px, transparent 1px, transparent 4px)',
          backgroundSize: '100% 4px',
        }}
      />
    </>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function LoadingScreen() {
  const navigate      = useNavigate();
  const location      = useLocation();
  const startPolling  = useJobStore(s => s.startPolling);
  const stopPolling   = useJobStore(s => s.stopPolling);
  const setActiveSong = useGameStore(s => s.setActiveSong);
  const resetGame     = useGameStore(s => s.resetGame);

  const ytUrl: string = (location.state as { ytUrl?: string } | null)?.ytUrl ?? '';

  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showBehind, setShowBehind] = useState(false);
  const [featuredSong, setFeaturedSong] = useState<CatalogEntry | null>(null);
  const [featuredChart, setFeaturedChart] = useState<ChartData | null>(null);

  // We only want to navigate once when complete
  const navigatedRef = useRef(false);
  const jobIdRef     = useRef<string | null>(null);

  // Load featured song for "play while you wait"
  useEffect(() => {
    fetch('/data/catalog.json')
      .then(r => r.json() as Promise<CatalogEntry[]>)
      .then(entries => {
        const featured = entries.find(e => e.featured) ?? entries[0];
        if (!featured) return;
        setFeaturedSong(featured);
        return fetch(featured.chart_url)
          .then(r => r.json() as Promise<ChartData>)
          .then(chart => setFeaturedChart(chart));
      })
      .catch(() => {/* non-fatal */});
  }, []);

  // On mount: POST /api/analyze, then start polling
  useEffect(() => {
    if (!ytUrl) {
      setError('No YouTube URL provided. Please go back and enter a URL.');
      return;
    }

    let cancelled = false;

    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: ytUrl }),
    })
      .then(async res => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({ detail: 'Server error' }));
          throw new Error(body.detail ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ job_id: string }>;
      })
      .then(({ job_id }) => {
        if (cancelled) return;
        jobIdRef.current = job_id;

        startPolling(
          job_id,
          // onUpdate
          (status) => {
            if (!cancelled) setJobStatus(status);
          },
          // onComplete
          (status) => {
            if (cancelled || navigatedRef.current) return;
            if (status.status === 'error') {
              setError(status.error ?? 'Analysis failed. Please try a different URL.');
              return;
            }
            // Fetch the finished chart and navigate
            fetchChartAndNavigate(job_id);
          },
        );
      })
      .catch(err => {
        if (!cancelled) setError(String(err.message ?? err));
      });

    return () => {
      cancelled = true;
      if (jobIdRef.current) stopPolling(jobIdRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytUrl]);

  const fetchChartAndNavigate = useCallback(
    async (jid: string) => {
      if (navigatedRef.current) return;
      navigatedRef.current = true;

      try {
        const res = await fetch(`/api/chart/${jid}`);
        if (!res.ok) throw new Error(`Chart not found (${res.status})`);
        const chart: ChartData = await res.json();
        resetGame();
        setActiveSong(chart, 'easy');
        navigate('/play');
      } catch (err) {
        navigatedRef.current = false;
        setError(`Failed to load chart: ${String((err as Error).message)}`);
      }
    },
    [navigate, setActiveSong, resetGame],
  );

  const handlePlayFeatured = useCallback(() => {
    if (!featuredSong || !featuredChart) return;
    resetGame();
    setActiveSong(featuredChart, 'easy');
    navigate('/play');
  }, [featuredSong, featuredChart, resetGame, setActiveSong, navigate]);

  const status     = jobStatus?.status ?? (error ? 'error' : 'queued');
  const progress   = jobStatus?.progress ?? 0;
  const detectedTitle = jobStatus?.details?.title;
  const detectedBpm   = jobStatus?.details?.bpm;

  const statusLabel: Record<string, string> = {
    queued:     'Waiting in queue...',
    extracting: 'Extracting audio...',
    analyzing:  'Analyzing audio...',
    generating: 'Generating chart...',
    complete:   'Chart ready! Loading...',
    error:      'Analysis failed',
  };

  return (
    <div
      className="relative h-full w-full"
      style={{ overflowY: 'auto', scrollbarWidth: 'none' } as React.CSSProperties}
    >
      <NeonBg />

      <div className="relative z-10 flex flex-col items-center px-4 pt-12 pb-24 min-h-full max-w-lg mx-auto">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <button
          className="self-start mb-8 text-xs tracking-widest transition-colors"
          style={{ color: 'rgba(255,255,255,0.35)' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ffff'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'; }}
          onClick={() => navigate('/')}
        >
          ← BACK
        </button>

        <h1
          className="text-3xl font-black tracking-[0.15em] text-center"
          style={{ color: '#ff8800', textShadow: '0 0 18px rgba(255,136,0,0.7)' }}
        >
          ANALYZING
        </h1>

        {/* URL display */}
        {ytUrl && (
          <p
            className="mt-2 text-xs text-center max-w-full truncate px-4"
            style={{ color: 'rgba(255,255,255,0.3)' }}
            title={ytUrl}
          >
            {ytUrl}
          </p>
        )}

        {/* ── Error state ───────────────────────────────────────────────── */}
        {error && (
          <div
            className="mt-8 w-full p-5 text-center"
            style={{
              border: '1px solid rgba(255,80,80,0.4)',
              background: 'rgba(255,40,40,0.07)',
            }}
          >
            <p className="text-sm font-bold mb-1" style={{ color: '#ff5555' }}>
              Analysis Failed
            </p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {error}
            </p>
            <button
              className="mt-4 px-6 py-2 text-xs tracking-widest transition-colors"
              style={{ border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#00ffff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(0,255,255,0.4)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'; }}
              onClick={() => navigate('/')}
            >
              TRY ANOTHER URL
            </button>
          </div>
        )}

        {!error && (
          <>
            {/* ── Progress bar ──────────────────────────────────────────── */}
            <div className="mt-10 w-full">
              <div className="flex justify-between items-center mb-2">
                <span
                  className="text-xs tracking-widest"
                  style={{ color: '#ff8800', textShadow: '0 0 8px rgba(255,136,0,0.5)' }}
                >
                  {statusLabel[status] ?? 'Processing...'}
                </span>
                <span
                  className="text-xs font-bold tabular-nums"
                  style={{ color: 'rgba(255,255,255,0.45)' }}
                >
                  {progress}%
                </span>
              </div>
              <div
                className="w-full h-2 relative overflow-hidden"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: `${progress}%`,
                    background: progress === 100
                      ? 'linear-gradient(90deg, #00ff88, #00ffcc)'
                      : 'linear-gradient(90deg, #ff8800, #ffcc00)',
                    boxShadow: progress === 100
                      ? '0 0 12px rgba(0,255,136,0.6)'
                      : '0 0 12px rgba(255,136,0,0.5)',
                    transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                />
                {/* Animated shimmer on the fill */}
                {progress > 0 && progress < 100 && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${progress - 8}%`,
                      top: 0, bottom: 0, width: '8%',
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                      animation: 'loading-shimmer 1.2s ease-in-out infinite',
                    }}
                  />
                )}
              </div>
            </div>

            {/* ── Detected metadata ─────────────────────────────────────── */}
            {(detectedTitle || detectedBpm) && (
              <div
                className="mt-4 w-full px-4 py-3 flex items-center gap-4"
                style={{
                  background: 'rgba(0,255,136,0.05)',
                  border: '1px solid rgba(0,255,136,0.18)',
                }}
              >
                <div className="text-lg" style={{ color: '#00ff88' }}>♪</div>
                <div className="flex-1 min-w-0">
                  {detectedTitle && (
                    <div
                      className="text-sm font-bold truncate"
                      style={{ color: 'rgba(255,255,255,0.88)', textShadow: '0 0 8px rgba(0,255,136,0.3)' }}
                    >
                      {detectedTitle}
                    </div>
                  )}
                  {detectedBpm && (
                    <div className="text-xs mt-0.5" style={{ color: 'rgba(0,255,136,0.75)' }}>
                      {Math.round(detectedBpm)} BPM detected
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Pipeline step indicators ──────────────────────────────── */}
            <div className="mt-8 w-full space-y-2">
              {STEPS.map((step) => {
                const state = getStepState(step, status as JobStatusType);
                return (
                  <div key={step.key} className="flex items-center gap-3">
                    {/* Icon */}
                    <div
                      style={{
                        width: 22, height: 22,
                        borderRadius: '50%',
                        flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 900,
                        background:
                          state === 'done'   ? 'rgba(0,255,136,0.18)' :
                          state === 'active' ? 'rgba(255,136,0,0.18)' :
                                              'rgba(255,255,255,0.04)',
                        border:
                          state === 'done'   ? '1px solid rgba(0,255,136,0.5)' :
                          state === 'active' ? '1px solid rgba(255,136,0,0.5)' :
                                              '1px solid rgba(255,255,255,0.1)',
                        color:
                          state === 'done'   ? '#00ff88' :
                          state === 'active' ? '#ff8800' :
                                              'rgba(255,255,255,0.2)',
                        boxShadow:
                          state === 'active' ? '0 0 8px rgba(255,136,0,0.35)' : 'none',
                      }}
                    >
                      {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
                    </div>

                    {/* Label */}
                    <span
                      className="text-sm tracking-wide"
                      style={{
                        color:
                          state === 'done'   ? 'rgba(0,255,136,0.8)' :
                          state === 'active' ? '#ff8800' :
                                              'rgba(255,255,255,0.22)',
                        fontWeight: state === 'active' ? 700 : 400,
                        textShadow: state === 'active' ? '0 0 8px rgba(255,136,0,0.5)' : 'none',
                      }}
                    >
                      {step.label}
                      {state === 'active' && (
                        <span style={{ opacity: 0.6 }}> — in progress</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* ── Play while you wait ───────────────────────────────────── */}
            {featuredSong && featuredChart && status !== 'complete' && (
              <div
                className="mt-10 w-full p-4"
                style={{
                  background: 'rgba(255,0,255,0.04)',
                  border: '1px solid rgba(255,0,255,0.18)',
                }}
              >
                <p
                  className="text-xs tracking-[0.22em] mb-3 select-none"
                  style={{ color: 'rgba(255,255,255,0.32)' }}
                >
                  PLAY WHILE YOU WAIT
                </p>
                <div className="flex items-center gap-3">
                  <div
                    className="shrink-0 text-2xl flex items-center justify-center"
                    style={{
                      width: 48, height: 48,
                      background: 'rgba(255,0,255,0.1)',
                      border: '1px solid rgba(255,0,255,0.25)',
                      color: '#ff00ff',
                    }}
                  >
                    ♪
                  </div>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-bold truncate"
                      style={{ color: '#ff00ff', textShadow: '0 0 8px rgba(255,0,255,0.5)' }}
                    >
                      {featuredSong.title}
                    </div>
                    <div className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {featuredSong.artist} · {featuredSong.bpm} BPM
                    </div>
                  </div>
                  <button
                    className="shrink-0 px-4 py-2 text-xs font-bold tracking-widest transition-all duration-150"
                    style={{
                      background: 'rgba(255,0,255,0.12)',
                      border: '1px solid rgba(255,0,255,0.5)',
                      color: '#ff00ff',
                      textShadow: '0 0 8px rgba(255,0,255,0.6)',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,0,255,0.22)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,0,255,0.12)'; }}
                    onClick={handlePlayFeatured}
                  >
                    ▶ PLAY
                  </button>
                </div>
              </div>
            )}

            {/* ── Behind the scenes ─────────────────────────────────────── */}
            <div className="mt-6 w-full">
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-xs tracking-widest transition-colors"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.35)',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.6)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'; }}
                onClick={() => setShowBehind(prev => !prev)}
              >
                <span>BEHIND THE SCENES</span>
                <span style={{ fontSize: 10 }}>{showBehind ? '▲' : '▼'}</span>
              </button>
              {showBehind && (
                <div
                  className="px-4 py-4 space-y-4"
                  style={{
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderTop: 'none',
                  }}
                >
                  {STEPS.map((step) => (
                    <div key={step.key}>
                      <div
                        className="text-xs font-bold tracking-wide mb-1"
                        style={{ color: 'rgba(255,136,0,0.8)' }}
                      >
                        {step.label}
                      </div>
                      <div
                        className="text-xs leading-relaxed"
                        style={{ color: 'rgba(255,255,255,0.42)' }}
                      >
                        {step.description}
                      </div>
                    </div>
                  ))}
                  <div
                    className="text-xs leading-relaxed pt-2"
                    style={{
                      color: 'rgba(255,255,255,0.28)',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    Results are cached in SQLite — re-analyzing the same video is instant.
                    WebGPU renders the game at up to 120 fps using instanced meshes for
                    zero-allocation arrow rendering.
                  </div>
                </div>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
