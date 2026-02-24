// JobStatusType matches backend JobState enum values
export type JobStatusType = 'queued' | 'extracting' | 'analyzing' | 'generating' | 'complete' | 'error';

/**
 * Job status response from GET /api/status/:job_id.
 *
 * The backend returns 'state' as the primary status field (matching the
 * Python JobState enum).  Fields 'title', 'artist', 'bpm', 'video_id' are
 * populated progressively as each pipeline stage completes.
 */
export interface JobStatus {
  job_id: string;
  /** Primary status field from backend (maps to Python JobState enum). */
  state: JobStatusType;
  progress: number;       // 0-100
  message?: string;
  // Metadata populated during extraction stage
  title?: string;
  artist?: string;
  bpm?: number;
  /** YouTube video ID — available once extraction completes. Used to fetch the chart. */
  video_id?: string;
  error?: string;
}
