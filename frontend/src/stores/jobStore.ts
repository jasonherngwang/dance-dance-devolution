import { create } from 'zustand';
import type { JobStatus } from '../types';

const POLL_INTERVAL_MS = 2000;

interface JobStore {
  jobs: Map<string, JobStatus>;

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
   */
  startPolling: (
    jobId: string,
    onUpdate?: (status: JobStatus) => void,
    onComplete?: (status: JobStatus) => void,
  ) => void;

  /** Stop polling for a specific job (e.g., if user cancels). */
  stopPolling: (jobId: string) => void;

  /** Stop all active pollers (e.g., on unmount). */
  stopAllPolling: () => void;
}

export const useJobStore = create<JobStore>((set, get) => ({
  jobs: new Map(),
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

  startPolling: (jobId, onUpdate, onComplete) => {
    const { _pollers, stopPolling } = get();

    // Don't double-start
    if (_pollers.has(jobId)) return;

    const handle = setInterval(async () => {
      try {
        const res = await fetch(`/api/status/${jobId}`);
        if (!res.ok) return;

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
        }
      } catch {
        // Network error — keep retrying until explicitly stopped
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
}));
