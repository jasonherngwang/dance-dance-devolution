import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useJobStore } from '@/stores/jobStore';
import { useGameStore } from '@/stores';
import type { ChartData } from '@/types';

/**
 * Global toast that appears (bottom-right, fixed position) when a YouTube
 * analysis job completes while the user is playing a different song.
 *
 * Mount this once inside <App /> so it persists across all routes.
 */
export default function SongReadyToast() {
  const navigate         = useNavigate();
  const completedJobs    = useJobStore(s => s.completedJobs);
  const clearCompletedJob = useJobStore(s => s.clearCompletedJob);
  const setActiveSong    = useGameStore(s => s.setActiveSong);
  const resetGame        = useGameStore(s => s.resetGame);

  const handlePlay = useCallback(async (jobId: string, videoId: string) => {
    clearCompletedJob(jobId);
    try {
      const res = await fetch(`/api/chart/${videoId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const chart: ChartData = await res.json();
      resetGame();
      setActiveSong(chart, 'easy');
      navigate('/play');
    } catch (err) {
      console.error('[SongReadyToast] Failed to load chart:', err);
    }
  }, [clearCompletedJob, setActiveSong, resetGame, navigate]);

  if (completedJobs.size === 0) return null;

  // Show first completed job (most common case: one pending job at a time)
  const [jobId, info] = [...completedJobs.entries()][0];

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        maxWidth: 300,
        background: 'rgba(0,12,6,0.94)',
        border: '1px solid rgba(0,255,136,0.55)',
        boxShadow: '0 0 24px rgba(0,255,136,0.22), 0 4px 16px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(10px)',
        animation: 'song-ready-in 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
      }}
    >
      {/* Music note icon */}
      <div
        style={{
          flexShrink: 0,
          fontSize: 20,
          color: '#00ff88',
          textShadow: '0 0 10px rgba(0,255,136,0.7)',
        }}
      >
        ♪
      </div>

      {/* Text content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.18em',
            color: 'rgba(0,255,136,0.7)',
            marginBottom: 3,
            fontWeight: 700,
          }}
        >
          YOUR SONG IS READY
        </div>
        {info.title && (
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.82)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textShadow: '0 0 6px rgba(0,255,136,0.2)',
            }}
          >
            {info.title}
          </div>
        )}
      </div>

      {/* Play button */}
      <button
        style={{
          flexShrink: 0,
          padding: '5px 11px',
          background: 'rgba(0,255,136,0.14)',
          border: '1px solid rgba(0,255,136,0.55)',
          color: '#00ff88',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.1em',
          cursor: 'pointer',
          textShadow: '0 0 8px rgba(0,255,136,0.6)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,136,0.26)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,255,136,0.14)'; }}
        onClick={() => handlePlay(jobId, info.videoId)}
      >
        ▶ PLAY
      </button>

      {/* Dismiss button */}
      <button
        style={{
          flexShrink: 0,
          padding: '2px 4px',
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.3)',
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.7)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.3)'; }}
        onClick={() => clearCompletedJob(jobId)}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
