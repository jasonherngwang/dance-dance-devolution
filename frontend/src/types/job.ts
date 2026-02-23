export type JobStatusType = 'queued' | 'extracting' | 'analyzing' | 'generating' | 'complete' | 'error';

export interface JobStatus {
  job_id: string;
  status: JobStatusType;
  progress: number;       // 0-100
  details?: {
    title?: string;
    artist?: string;
    bpm?: number;
    duration?: number;
  };
  error?: string;
}
