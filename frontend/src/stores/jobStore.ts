import { create } from 'zustand';
import type { JobStatus } from '../types';

const POLL_INTERVAL_MS = 2000;
// Number of consecutive network failures before notifying the caller
const NETWORK_ERROR_THRESHOLD = 5;

export interface PendingJobInfo {
  /** Song title extracted during analysis, if available. */
  title?: string;
}

export interface CompletedJobInfo {
  /** YouTube video ID — used to fetch the chart. */
  videoId: string;
  /** Song title, if known at completion time. */
  title?: string;
}

interface JobStore {
  jobs: Map<string, JobStatus>;

  /**
   * Jobs the user opted to wait on by clicking "Play while you wait".
   * These are tracked globally so a notification can appear on any screen.
   */
  pendingJobs: Map<string, PendingJobInfo>;

  /**
   * Jobs that completed while the user was playing a different song.
   * Each entry represents a ready chart waiting to be played.
   */
  completedJobs: Map<string, CompletedJobInfo>;

  // Add/update a job
  upsertJob: (status: JobStatus) => void;

  // Remove a completed/errored job from the map
  removeJob: (jobId: string) => void;

  // Polling handles keyed by jobId
  _pollers: Map<string, ReturnType<typeof setInterval>>;

  /**
   * Start polling GET /api/status/:jobId every 2 seconds.
   * Stops automatically when the job is complete or errored.
   * onComplete is called with the final JobStatus when done.
   * onNetworkError is called after NETWORK_ERROR_THRESHOLD consecutive failures.
   */
  startPolling: (
    jobId: string,
    onUpdate?: (status: JobStatus) => void,
    onComplete?: (status: JobStatus) => void,
    onNetworkError?: () => void,
  ) => void;

  /** Stop polling for a specific job (e.g., if user cancels). */
  stopPolling: (jobId: string) => void;

  /** Stop all active pollers (e.g., on unmount). */
  stopAllPolling: () => void;

  /**
   * Register a job for global tracking. Called when the user chooses to
   * "Play while you wait" — keeps polling alive after LoadingScreen unmounts
   * and delivers a completion notification regardless of which screen is active.
   */
  registerPendingJob: (jobId: string, info: PendingJobInfo) => void;

  /** Dismiss (clear) a completed-job notification. */
  clearCompletedJob: (jobId: string) => void;
}

export const useJobStore = create<JobStore>((set, get) => ({
  jobs: new Map(),
  pendingJobs: new Map(),
  completedJobs: new Map(),
  _pollers: new Map(),

  upsertJob: (status) => {
    set((state) => {
      const next = new Map(state.jobs);
      next.set(status.job_id, status);
      return { jobs: next };
    });
  },

  removeJob: (jobId) => {
    set((state) => {
      const next = new Map(state.jobs);
      next.delete(jobId);
      return { jobs: next };
    });
  },

  startPolling: (jobId, onUpdate, onComplete, onNetworkError) => {
    const { _pollers, stopPolling } = get();

    // Don't double-start
    if (_pollers.has(jobId)) return;

    let consecutiveErrors = 0;
    let networkErrorNotified = false;

    const handle = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) {
          // Non-2xx from a reachable server — not a network error, keep waiting
          consecutiveErrors = 0;
          networkErrorNotified = false;
          return;
        }

        // Successful fetch — reset error counter
        consecutiveErrors = 0;
        networkErrorNotified = false;

        const status: JobStatus = await res.json();
        get().upsertJob(status);
        onUpdate?.(status);

        // Backend returns 'state'; check both for robustness
        const isDone =
          status.state === 'complete' || status.state === 'error' ||
          status.status === 'complete' || status.status === 'error';
        if (isDone) {
          stopPolling(jobId);
          onComplete?.(status);

          // If this was a "play while waiting" job, move it to completedJobs
          const isComplete = status.state === 'complete' || status.status === 'complete';
          if (isComplete && status.video_id) {
            const pendingInfo = get().pendingJobs.get(jobId);
            if (pendingInfo) {
              set((state) => {
                const completedNext = new Map(state.completedJobs);
                completedNext.set(jobId, {
                  videoId: status.video_id!,
                  title: pendingInfo.title ?? status.title,
                });
                const pendingNext = new Map(state.pendingJobs);
                pendingNext.delete(jobId);
                return { completedJobs: completedNext, pendingJobs: pendingNext };
              });
            }
          }
        }
      } catch {
        // Network error (fetch threw — server unreachable)
        consecutiveErrors += 1;
        if (!networkErrorNotified && consecutiveErrors >= NETWORK_ERROR_THRESHOLD) {
          networkErrorNotified = true;
          onNetworkError?.();
        }
      }
    }, POLL_INTERVAL_MS);

    set((state) => {
      const next = new Map(state._pollers);
      next.set(jobId, handle);
      return { _pollers: next };
    });
  },

  stopPolling: (jobId) => {
    const { _pollers } = get();
    const handle = _pollers.get(jobId);
    if (handle !== undefined) {
      clearInterval(handle);
      set((state) => {
        const next = new Map(state._pollers);
        next.delete(jobId);
        return { _pollers: next };
      });
    }
  },

  stopAllPolling: () => {
    const { _pollers } = get();
    for (const handle of _pollers.values()) {
      clearInterval(handle);
    }
    set({ _pollers: new Map() });
  },

  registerPendingJob: (jobId, info) => {
    set((state) => {
      const next = new Map(state.pendingJobs);
      next.set(jobId, info);
      return { pendingJobs: next };
    });
  },

  clearCompletedJob: (jobId) => {
    set((state) => {
      const next = new Map(state.completedJobs);
      next.delete(jobId);
      return { completedJobs: next };
    });
  },
}));
